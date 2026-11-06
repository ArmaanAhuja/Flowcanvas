// A test-only Worker (never deployed): the real terminal relay and the real local-host adapter running in
// workerd, without sign-in, so local-host.docker.test.ts can prove the relay against a real workspace.
import { localHostProvider } from '../workspaces/local-host.js';
import { relay, workersAcceptWebSocket } from '../workspaces/terminal-routes.js';

interface Env {
  readonly HOST_URL: string;
  readonly HOST_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const provider = localHostProvider({
      url: env.HOST_URL,
      token: env.HOST_TOKEN,
      fetch: (input, init) => fetch(input, init),
    });
    const workspace = await provider.terminal(url.searchParams.get('ref') ?? '', {
      cols: 80,
      rows: 24,
    });
    const { response, socket } = workersAcceptWebSocket();
    relay(socket, workspace, () => undefined);
    return response;
  },
};
