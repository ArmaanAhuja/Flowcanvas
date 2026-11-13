// One fake workspace for the walkthroughs (owner, 12 Nov 2026: "one shared fake workspace", as long as it changes
// nothing the tests prove). It answers the control plane's routes as a running workspace would: the signed-in member
// and their project, files with real versions (SHA-256) and conflict-checked saves, the journal of unsaved changes
// with the agent's rule (an older revision never replaces a newer), the file watcher's events, and the index. What a
// phase adds (search results, the Calls tab's answers, the graph, flows) comes in through `answers`. The real
// workspace is proven by the Docker tests (workspace/host/src/*.docker.test.ts).
import { createHash } from 'node:crypto';
import type { Page, Route, WebSocketRoute } from '@playwright/test';

export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** A project with a running workspace, as `/api/projects` lists it. */
export function runningProject(id: string, createdAt: string, name = 'Rallly') {
  return {
    id,
    name,
    repoUrl: `https://github.com/ArmaanAhuja-7777/${name.toLowerCase()}`,
    repoCommit: null,
    createdAt,
    workspace: {
      id: `w-${id.slice(-2)}`,
      state: 'running',
      stateChangedAt: createdAt,
      failure: null,
    },
  };
}

/** The index once it's read every file (Rallly's numbers at its pin). */
export const INDEX_READY = {
  state: 'ready',
  done: 1958,
  total: 1958,
  files: 1958,
  byStatus: { parsed: 1958, 'no-grammar': 0, 'too-large': 0, binary: 0, unreadable: 0 },
  symbols: 5874,
  withSyntaxErrors: 0,
  partlyRead: 0,
  lastFullMs: 1015,
  message: null,
};

/** An answer with a status other than 200; any other answer is the JSON body, sent with 200. */
export class WithStatus {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

export interface FakeWorkspaceOptions {
  readonly project: ReturnType<typeof runningProject>;
  /** The project's text files. */
  readonly files?: Readonly<Record<string, string>>;
  /** Binary files, as base64. */
  readonly binary?: Readonly<Record<string, string>>;
  /** Listed in the tree but never read, as the agent treats `.env` files. */
  readonly unreadable?: readonly string[];
  /** The index's status, asked each time (to go from indexing to ready). */
  readonly indexStatus?: () => unknown;
  /**
   * What a phase adds, by the route's path suffix (`/workspace/index/flow`, `/api/usage`): asked with the request's
   * address; checked before the common routes.
   */
  readonly answers?: Readonly<Record<string, (url: URL) => unknown>>;
}

export class FakeWorkspace {
  readonly files: Map<string, string>;
  readonly binary: Map<string, string>;
  /** The journal of unsaved changes, as the agent keeps it. */
  readonly journal = new Map<
    string,
    {
      path: string;
      content: string;
      baseVersion: string | null;
      revision: number;
      updatedAt: number;
    }
  >();
  /** Pages listening to the file watcher. */
  readonly watchers: WebSocketRoute[] = [];
  /** Every question asked of a route in `answers`, as `suffix ?query`. */
  readonly asked: string[] = [];

  constructor(
    page: Page,
    private readonly options: FakeWorkspaceOptions,
  ) {
    this.files = new Map(Object.entries(options.files ?? {}));
    this.binary = new Map(Object.entries(options.binary ?? {}));
    this.ready = this.watch(page);
  }

  /** Settles once the first page's routes are in place: await it before navigating, to be sure they're used. */
  readonly ready: Promise<void>;

  /**
   * Serves a page from this workspace. Routed on the browser context, not the page: a request sent as a page closes
   * (keepalive) outlives the page, and the page's own routes go with it.
   */
  async watch(page: Page): Promise<void> {
    await page.context().route('**/api/**', (route) => this.answer(route));
    // The workspace's file watcher, as the control plane relays it: one checked event per message.
    await page.context().routeWebSocket(/\/workspace\/events$/, (socket) => {
      this.watchers.push(socket);
    });
  }

  /** An edit made in the workspace's terminal: the file changes, and the watcher says so. */
  terminalWrites(path: string, content: string): void {
    this.files.set(path, content);
    for (const socket of this.watchers) {
      socket.send(JSON.stringify({ type: 'changed', path, deleted: false, version: sha(content) }));
    }
  }

  terminalDeletes(path: string): void {
    this.files.delete(path);
    for (const socket of this.watchers) {
      socket.send(JSON.stringify({ type: 'changed', path, deleted: true, version: null }));
    }
  }

  private reply(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  }

  private answer(route: Route) {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') ?? '';
    for (const [suffix, answer] of Object.entries(this.options.answers ?? {})) {
      if (url.pathname.endsWith(suffix)) {
        this.asked.push(`${suffix} ${url.search}`);
        const said = answer(url);
        return said instanceof WithStatus
          ? this.reply(route, said.body, said.status)
          : this.reply(route, said);
      }
    }
    if (url.pathname === '/api/me') {
      return this.reply(route, {
        user: { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role: 'member' },
        signIn: 'available',
        providers: ['github'],
      });
    }
    if (url.pathname === '/api/projects')
      return this.reply(route, { projects: [this.options.project], workspacesAvailable: true });
    if (url.pathname.endsWith('/workspace/index/status'))
      return this.reply(route, this.options.indexStatus?.() ?? INDEX_READY);
    if (url.pathname.endsWith('/workspace/tree')) {
      return this.reply(route, {
        files: [
          ...this.files.keys(),
          ...this.binary.keys(),
          ...(this.options.unreadable ?? []),
        ].sort(),
        truncated: false,
        source: 'git',
      });
    }
    if (url.pathname.endsWith('/workspace/journal')) {
      return this.reply(route, {
        entries: [...this.journal.values()].map(({ path: p, revision }) => ({ path: p, revision })),
      });
    }
    if (url.pathname.endsWith('/workspace/journal/entry'))
      return this.journalEntry(route, url, path);
    if (url.pathname.endsWith('/workspace/file')) return this.file(route, path);
    return this.reply(route, { error: 'not found' }, 404);
  }

  private journalEntry(route: Route, url: URL, path: string) {
    const method = route.request().method();
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as {
        content: string;
        baseVersion: string | null;
        revision: number;
      };
      const existing = this.journal.get(path);
      if (existing === undefined || existing.revision <= body.revision) {
        this.journal.set(path, { path, ...body, updatedAt: Date.now() });
      }
      return this.reply(route, { path, revision: body.revision });
    }
    if (method === 'DELETE') {
      const existing = this.journal.get(path);
      if (existing !== undefined && existing.revision <= Number(url.searchParams.get('revision'))) {
        this.journal.delete(path);
      }
      return this.reply(route, { path, dropped: true });
    }
    const entry = this.journal.get(path);
    return entry === undefined
      ? this.reply(
          route,
          { error: 'There are no unsaved changes for that file.', code: 'not_found' },
          404,
        )
      : this.reply(route, entry);
  }

  private file(route: Route, path: string) {
    const nothing = () =>
      this.reply(route, { error: 'There’s nothing at that path.', code: 'not_found' }, 404);
    if (this.options.unreadable?.includes(path)) return nothing();
    const content = this.files.get(path);
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        content: string;
        baseVersion: string | null;
      };
      const current = content === undefined ? null : sha(content);
      if (body.baseVersion !== current) {
        return this.reply(
          route,
          { error: 'This file changed in the workspace since you opened it.', code: 'conflict' },
          409,
        );
      }
      this.files.set(path, body.content);
      return this.reply(route, { path, size: body.content.length, version: sha(body.content) });
    }
    const binary = this.binary.get(path);
    if (binary !== undefined) {
      return this.reply(route, {
        path,
        size: Buffer.from(binary, 'base64').length,
        encoding: 'base64',
        content: binary,
        version: sha(binary),
      });
    }
    if (content === undefined) return nothing();
    return this.reply(route, {
      path,
      size: content.length,
      encoding: 'utf8',
      content,
      version: sha(content),
    });
  }
}
