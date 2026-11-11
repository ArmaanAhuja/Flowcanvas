// The engine's side of its line protocol (ADR 0025): one JSON envelope per line in, one answer per line out,
// matched by id, like the workspace agent's (ADR 0016).
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import {
  ENGINE_LIMITS,
  ENGINE_PROTOCOL,
  EngineProblem,
  parseEngineRequest,
  type EngineEnvelope,
  type EngineResponse,
} from './protocol.js';
import type { EngineService } from './service.js';

/** Answers requests until the input ends (the host closed stdin). */
export function serveEngine(
  service: EngineService,
  input: Readable,
  output: Writable,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const send = (id: number, body: EngineResponse) => {
    const envelope: EngineEnvelope<EngineResponse> = { v: ENGINE_PROTOCOL, id, body };
    output.write(`${JSON.stringify(envelope)}\n`);
  };
  lines.on('line', (line) => {
    let id = 0;
    void (async () => {
      try {
        if (line.length > ENGINE_LIMITS.lineBytes) {
          throw new EngineProblem('invalid_request', 'That request is too large.');
        }
        let envelope: Partial<EngineEnvelope<unknown>>;
        try {
          envelope = JSON.parse(line) as Partial<EngineEnvelope<unknown>>;
        } catch {
          throw new EngineProblem('invalid_request', 'Send one JSON message per line.');
        }
        id = typeof envelope.id === 'number' && Number.isSafeInteger(envelope.id) ? envelope.id : 0;
        if (envelope.v !== ENGINE_PROTOCOL) {
          throw new EngineProblem(
            'invalid_request',
            `This engine speaks protocol ${String(ENGINE_PROTOCOL)}.`,
          );
        }
        const result = await service.handle(parseEngineRequest(envelope.body));
        send(id, { ok: true, result });
      } catch (error) {
        // Our own refusals keep their words; anything else is described without its details.
        send(
          id,
          error instanceof EngineProblem
            ? { ok: false, error: { code: error.code, message: error.message } }
            : { ok: false, error: { code: 'failed', message: 'The engine couldn’t answer that.' } },
        );
      }
    })();
  });
  return new Promise((done) => lines.on('close', done));
}
