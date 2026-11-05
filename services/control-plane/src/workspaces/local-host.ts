// The WorkspaceProvider for local development: calls the local workspace host on 127.0.0.1 (ADR 0016).
// Staging has no WORKSPACE_HOST_URL, so there's no provider there and the API says workspaces run locally.
import {
  MESSAGE_MAX,
  PATHS,
  isHostErrorKind,
  isPressureKind,
  type CreateResponse,
  type HostAction,
  type PressureResponse,
} from '@flowcanvas/workspace-host/protocol';
import {
  isAgentResponse,
  type AgentRequest,
  type AgentResponse,
} from '@flowcanvas/workspace-agent/protocol';
import { ProviderError, type TerminalSocket, type WorkspaceProvider } from './provider.js';

export interface LocalHostBindings {
  readonly WORKSPACE_HOST_URL?: string;
  readonly WORKSPACE_HOST_TOKEN?: string;
}

/** Creating can include building the image (about a minute, once) and the clone (60 s at most). */
const CREATE_TIMEOUT_MS = 180_000;
const ACTION_TIMEOUT_MS = 30_000;
/** On top of a command's own time limit, for the host and the agent to answer. */
const AGENT_GRACE_MS = 20_000;

export const MESSAGES = {
  notRunning: "The workspace host isn't running. Start it with pnpm dev, then try again.",
  noToken: 'Add WORKSPACE_HOST_TOKEN to .dev.vars (see .dev.vars.example), then restart pnpm dev.',
  unexpected: 'The workspace host gave an answer we didn’t expect. Try again in a moment.',
} as const;

/** Only addresses on this computer: the token must never be sent anywhere else. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      parsed.pathname === '/' &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

/** A provider that always says why it can't work: for a local setup that's missing its token. */
function misconfigured(message: string): WorkspaceProvider {
  const refuse = () => Promise.reject(new ProviderError('unavailable', message));
  return {
    name: 'docker-local',
    create: refuse,
    start: refuse,
    pause: refuse,
    resume: refuse,
    stop: refuse,
    agent: refuse,
    terminal: refuse,
  };
}

/** The provider for these bindings, or undefined where nothing runs workspaces (staging, for now). */
export function localHostFromEnv(
  env: LocalHostBindings,
  fetcher: typeof fetch,
): WorkspaceProvider | undefined {
  const url = env.WORKSPACE_HOST_URL;
  if (url === undefined || url === '' || !isLoopbackUrl(url)) return undefined;
  const token = env.WORKSPACE_HOST_TOKEN ?? '';
  if (token.length < 32) return misconfigured(MESSAGES.noToken);
  return localHostProvider({ url, token, fetch: fetcher });
}

export function localHostProvider(options: {
  readonly url: string;
  readonly token: string;
  readonly fetch: typeof fetch;
}): WorkspaceProvider {
  const base = options.url.replace(/\/$/, '');

  async function call(path: string, body: unknown, timeoutMs: number): Promise<Response> {
    let response: Response;
    try {
      response = await options.fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Connection refused, or no answer in time: either way, from here it isn't running.
      throw new ProviderError('unavailable', MESSAGES.notRunning);
    }
    if (response.ok) return response;
    throw await hostError(response);
  }

  async function action(ref: string, name: HostAction): Promise<void> {
    await call(PATHS.action(ref, name), undefined, ACTION_TIMEOUT_MS);
  }

  return {
    name: 'docker-local',
    async create(input) {
      const response = await call(
        PATHS.create,
        { workspaceId: input.workspaceId, repoUrl: input.repoUrl },
        CREATE_TIMEOUT_MS,
      );
      const body = (await response.json().catch(() => undefined)) as
        Partial<CreateResponse> | undefined;
      if (typeof body?.ref !== 'string' || body.ref === '' || body.ref.length > 200) {
        throw new ProviderError('failed', MESSAGES.unexpected);
      }
      return { ref: body.ref };
    },
    start: (ref) => action(ref, 'start'),
    pause: (ref) => action(ref, 'pause'),
    resume: (ref) => action(ref, 'resume'),
    stop: (ref) => action(ref, 'stop'),
    async agent(ref: string, request: AgentRequest): Promise<AgentResponse> {
      const timeout =
        (request.op === 'exec' ? request.timeoutMs : ACTION_TIMEOUT_MS) + AGENT_GRACE_MS;
      const response = await call(PATHS.agent(ref), request, timeout);
      const body: unknown = await response.json().catch(() => undefined);
      // From inside the workspace: checked before anything is passed on.
      if (!isAgentResponse(body)) throw new ProviderError('failed', MESSAGES.unexpected);
      return body;
    },
    async pressure() {
      let response: Response;
      try {
        response = await options.fetch(`${base}${PATHS.pressure}`, {
          headers: { authorization: `Bearer ${options.token}` },
          signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
        });
      } catch {
        throw new ProviderError('unavailable', MESSAGES.notRunning);
      }
      if (!response.ok) throw await hostError(response);
      const body = (await response.json().catch(() => undefined)) as
        Partial<PressureResponse> | undefined;
      // Only the kinds are needed here; the host's own sentences are for its refusals.
      if (!Array.isArray(body?.pressure)) throw new ProviderError('failed', MESSAGES.unexpected);
      return body.pressure
        .map((entry: unknown) =>
          typeof entry === 'object' && entry !== null
            ? (entry as { kind?: unknown }).kind
            : undefined,
        )
        .filter(isPressureKind);
    },
    async terminal(ref, size) {
      let response: Response;
      try {
        // Workers open an outgoing WebSocket with an ordinary fetch and an Upgrade header.
        response = await options.fetch(`${base}${PATHS.terminal(ref, size.cols, size.rows)}`, {
          headers: { upgrade: 'websocket', authorization: `Bearer ${options.token}` },
        });
      } catch {
        throw new ProviderError('unavailable', MESSAGES.notRunning);
      }
      const socket = (response as Response & { webSocket?: TerminalSocket | null }).webSocket;
      if (response.status === 101 && socket) return socket;
      throw await hostError(response);
    },
  };
}

/** The host's error as a ProviderError, checked: only known kinds and a bounded sentence pass through. */
async function hostError(response: Response): Promise<ProviderError> {
  // Different tokens on the two sides: say how to fix it, whatever the host's own words were.
  if (response.status === 401) return new ProviderError('unavailable', MESSAGES.noToken);
  const body = (await response.json().catch(() => undefined)) as
    { error?: { kind?: unknown; message?: unknown } } | undefined;
  const kind = body?.error?.kind;
  const message = body?.error?.message;
  if (
    isHostErrorKind(kind) &&
    typeof message === 'string' &&
    message !== '' &&
    message.length <= MESSAGE_MAX
  ) {
    return new ProviderError(kind, message);
  }
  return new ProviderError('failed', MESSAGES.unexpected);
}
