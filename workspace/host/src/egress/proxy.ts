// The egress proxy (ADR 0016): the only way out of a workspace. It runs in its own container (Node strips the
// types, so this file uses Node's built-in modules only and no TypeScript-only syntax such as enums).
//
// - HTTPS only: `CONNECT host:443`. Plain HTTP and every other port are refused.
// - Allowlisted hosts only: what cloning and installing need, each for a reason measured in phase 1d step 7.
// - Limits: open tunnels per workspace and in total, a deadline for the CONNECT line, an idle timeout.
// - It resolves the name itself and connects to the address it checked, refusing private, loopback, link-local
//   and other non-public addresses, so a DNS answer can't point a workspace at the home network or the host.
import { lookup } from 'node:dns/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { BlockList, connect, isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

export const PORT = 3128;

/**
 * Hosts a workspace may reach, exactly (no wildcards), and why. Each was needed by a corpus repository
 * (phase 1d step 7). A project's own APIs at run time are a per-project choice, later (upgrade-later 37).
 */
export const ALLOWED = Object.freeze({
  'github.com': 'cloning public repositories, and git dependencies',
  'codeload.github.com': 'GitHub tarball dependencies (github: specifiers)',
  'registry.npmjs.org': 'installing packages with npm and pnpm',
  'registry.yarnpkg.com':
    'installing packages with Yarn (its lockfiles and default registry name it)',
  'binaries.prisma.sh': "Prisma's engines, downloaded by prisma generate and migrate",
});
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set(Object.keys(ALLOWED));

export interface ProxyLimits {
  tunnelsPerClient: number;
  tunnels: number;
  headersMs: number;
  idleMs: number;
}

export const LIMITS: Readonly<ProxyLimits> = Object.freeze({
  /** Tunnels open at once from one workspace; pnpm opens about 16. */
  tunnelsPerClient: 64,
  /** Tunnels open at once in all. */
  tunnels: 256,
  /** Time to send the CONNECT request, so half-open connections can't pile up. */
  headersMs: 10_000,
  /** A tunnel with nothing sent either way for this long is closed. */
  idleMs: 60_000,
});

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
/** Opens the upstream connection to an address the proxy checked. */
export type Dial = (address: string, port: number) => Socket;

const dialDirect: Dial = (host, port) => connect({ host, port });

const resolveAll: Resolve = async (host) =>
  (await lookup(host, { all: true, order: 'verbatim' })).map((entry) => entry.address);

function refuse(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export interface ProxyOptions {
  resolve?: Resolve;
  dial?: Dial;
  log?: (line: string) => void;
  limits?: Partial<ProxyLimits>;
}

/** The proxy server. Everything but the rules is replaceable for tests. */
export function createProxy(options: ProxyOptions = {}): Server {
  const resolve = options.resolve ?? resolveAll;
  const dial = options.dial ?? dialDirect;
  const limits = { ...LIMITS, ...options.limits };
  const log =
    options.log ??
    ((line: string) => {
      console.log(line);
    });
  // Node checks the header deadline only this often (30 s by default), so check well within it.
  const checkEvery = Math.max(50, Math.min(1_000, Math.floor(limits.headersMs / 4)));
  const server = createServer(
    { connectionsCheckingInterval: checkEvery },
    (request: IncomingMessage, response) => {
      // Plain HTTP would let a workspace talk to anything without TLS; only CONNECT is offered.
      log(`refused ${request.method ?? '?'} (plain HTTP)`);
      response.writeHead(403, { connection: 'close' }).end();
    },
  );
  server.headersTimeout = limits.headersMs;
  server.requestTimeout = limits.headersMs;

  // Open tunnels (and ones being set up) per workspace address.
  const open = new Map<string, number>();
  let total = 0;
  function take(client: string): boolean {
    const mine = open.get(client) ?? 0;
    if (mine >= limits.tunnelsPerClient || total >= limits.tunnels) return false;
    open.set(client, mine + 1);
    total += 1;
    return true;
  }
  function give(client: string): void {
    const mine = (open.get(client) ?? 1) - 1;
    if (mine <= 0) open.delete(client);
    else open.set(client, mine);
    total -= 1;
  }

  server.on('connect', (request: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on('error', () => client.destroy());
    const target = checkTarget(request.url ?? '');
    if ('refused' in target) {
      log(`refused CONNECT: ${target.refused}`);
      refuse(client, '403 Forbidden');
      return;
    }
    // Typed as a Duplex, but for a TCP server it is the client's net.Socket.
    const from = (client as Socket).remoteAddress ?? '?';
    if (!take(from)) {
      log(`refused CONNECT ${target.host}: too many tunnels`);
      refuse(client, '429 Too Many Requests');
      return;
    }
    let given = false;
    const release = () => {
      if (given) return;
      given = true;
      give(from);
    };
    client.on('close', release);
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
      if (client.destroyed) return;
      const upstream = dial(address, target.port);
      upstream.setTimeout(limits.idleMs);
      upstream.on('timeout', () => upstream.destroy());
      // 'close' follows every error; it decides what the client hears.
      upstream.on('error', () => undefined);
      let connected = false;
      upstream.on('connect', () => {
        connected = true;
        log(`allowed CONNECT ${target.host}`);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => {
        // Inside a tunnel, the bytes are TLS: an HTTP answer there would corrupt them, so just close.
        if (connected) client.destroy();
        else refuse(client, '502 Bad Gateway');
      });
    })();
  });
  return server;
}

if (import.meta.main) {
  createProxy().listen(PORT, '0.0.0.0', () => {
    console.log(`egress proxy listening on ${String(PORT)}`);
  });
}
