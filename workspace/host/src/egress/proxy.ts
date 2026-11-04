// The egress proxy (ADR 0016): the only way out of a workspace. It runs in its own container (Node strips the
// types, so this file uses Node's built-in modules only and no TypeScript-only syntax such as enums).
//
// - HTTPS only: `CONNECT host:443`. Plain HTTP and every other port are refused.
// - Allowlisted hosts only (GitHub for clones now; the npm registry and more in step 7).
// - It resolves the name itself and connects to the address it checked, refusing private, loopback, link-local
//   and other non-public addresses, so a DNS answer can't point a workspace at the home network or the host.
import { lookup } from 'node:dns/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { BlockList, connect, isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

export const PORT = 3128;

/** Hosts a workspace may reach, exactly (no wildcards). */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set(['github.com', 'codeload.github.com']);

// Every range that isn't the public internet (IANA special-purpose registries).
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 127],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** Whether an address is on the public internet. Anything that isn't a valid address is not. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is refused outright. It isn't in the list because Node's BlockList
  // matches every plain IPv4 address against ::ffff:0:0/96, which would block the whole IPv4 internet.
  if (family === 6 && /^::ffff:/i.test(address)) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Parses a CONNECT target (`host:443`) and decides whether it's allowed, with the reason if not. */
export function checkTarget(target: string): { host: string; port: number } | { refused: string } {
  const match = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(target);
  if (match === null) return { refused: 'malformed target' };
  const host = (match[1] ?? '').toLowerCase().replace(/\.$/, '');
  const port = Number(match[2]);
  if (port !== 443) return { refused: `port ${String(port)}` };
  if (!ALLOWED_HOSTS.has(host)) return { refused: `host ${host} not allowed` };
  return { host, port };
}

export type Resolve = (host: string) => Promise<string[]>;

const resolveAll: Resolve = async (host) =>
  (await lookup(host, { all: true, order: 'verbatim' })).map((entry) => entry.address);

function refuse(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** The proxy server. `resolve` and `log` are replaceable for tests. */
export function createProxy(
  options: { resolve?: Resolve; log?: (line: string) => void } = {},
): Server {
  const resolve = options.resolve ?? resolveAll;
  const log =
    options.log ??
    ((line: string) => {
      console.log(line);
    });
  const server = createServer((request: IncomingMessage, response) => {
    // Plain HTTP would let a workspace talk to anything without TLS; only CONNECT is offered.
    log(`refused ${request.method ?? '?'} (plain HTTP)`);
    response.writeHead(403, { connection: 'close' }).end();
  });

  server.on('connect', (request: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on('error', () => client.destroy());
    const target = checkTarget(request.url ?? '');
    if ('refused' in target) {
      log(`refused CONNECT: ${target.refused}`);
      refuse(client, '403 Forbidden');
      return;
    }
    void (async () => {
      let addresses: string[];
      try {
        addresses = await resolve(target.host);
      } catch {
        log(`refused CONNECT ${target.host}: no address`);
        refuse(client, '502 Bad Gateway');
        return;
      }
      const address = addresses.find(isPublicAddress);
      if (address === undefined) {
        log(`refused CONNECT ${target.host}: not a public address`);
        refuse(client, '403 Forbidden');
        return;
      }
      const upstream: Socket = connect({ host: address, port: target.port, timeout: 30_000 });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        refuse(client, '502 Bad Gateway');
      });
      upstream.on('connect', () => {
        log(`allowed CONNECT ${target.host}`);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    })();
  });
  return server;
}

if (import.meta.main) {
  createProxy().listen(PORT, '0.0.0.0', () => {
    console.log(`egress proxy listening on ${String(PORT)}`);
  });
}
