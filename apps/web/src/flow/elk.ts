// ELK for the page: in a Web Worker of its own (CLAUDE.md section 7: never the UI thread), loaded the first time a
// flow is opened. The worker is a file from our own origin, which the security policy allows (script-src 'self').
import type { ElkLike } from './layout';

let elk: Promise<ElkLike> | undefined;

export function pageElk(): Promise<ElkLike> {
  elk ??= (async () => {
    const [{ default: ELK }, { default: ElkWorker }] = await Promise.all([
      import('elkjs/lib/elk-api.js'),
      import('elkjs/lib/elk-worker.min.js?worker'),
    ]);
    return new ELK({ workerFactory: () => new ElkWorker() });
  })();
  return elk;
}
