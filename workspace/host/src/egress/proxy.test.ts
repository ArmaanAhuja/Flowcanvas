import { createServer, type Server } from 'node:http';
import { connect, createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED,
  ALLOWED_HOSTS,
  checkTarget,
  createProxy,
  isPublicAddress,
  type Dial,
  type ProxyOptions,
  type Resolve,
} from './proxy.js';

describe('the allowlist', () => {
  it('is exactly what cloning and installing the corpus needs, each with its reason', () => {
    // Widening it is a decision: change this test, the reasons and the build steps together.
    expect([...ALLOWED_HOSTS].sort()).toEqual([
      'binaries.prisma.sh',
      'codeload.github.com',
      'github.com',
      'registry.npmjs.org',
      'registry.yarnpkg.com',
    ]);
    for (const reason of Object.values(ALLOWED)) expect(reason.length).toBeGreaterThan(10);
  });

  it('allows each of them on 443 only', () => {
    for (const host of ALLOWED_HOSTS) {
      expect(checkTarget(`${host}:443`)).toEqual({ host, port: 443 });
      expect(checkTarget(`${host}:80`)).toHaveProperty('refused');
    }
  });
});

describe('isPublicAddress', () => {
  it('allows public addresses', () => {
    for (const address of ['140.82.112.3', '1.1.1.1', '2606:4700:4700::1111', '2a01:4f8::1']) {
      expect(isPublicAddress(address)).toBe(true);
    }
  });

  it('refuses the host, the home network, the cloud metadata address and other special ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.5',
      '172.17.0.1',
      '172.22.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('refuses anything that is not an address', () => {
    for (const value of ['', 'github.com', '1.2.3', '999.1.1.1', '1.2.3.4 ']) {
      expect(isPublicAddress(value)).toBe(false);
    }
  });
});

describe('checkTarget', () => {
  it('allows the allowlisted hosts on 443, in any case and with a trailing dot', () => {
    expect(checkTarget('github.com:443')).toEqual({ host: 'github.com', port: 443 });
    expect(checkTarget('GitHub.COM.:443')).toEqual({ host: 'github.com', port: 443 });
    expect(checkTarget('codeload.github.com:443')).toMatchObject({ host: 'codeload.github.com' });
  });

  it('refuses other ports, other hosts and lookalikes', () => {
    for (const target of [
      'github.com:80',
      'github.com:22',
      'example.com:443',
      'github.com.evil.example:443',
      'evilgithub.com:443',
      'api.github.com:443',
      '140.82.112.3:443',
      'github.com',
      'github.com:443/path',
      '[::1]:443',
    ]) {
      expect(checkTarget(target), target).toHaveProperty('refused');
    }
  });
});

describe('the proxy', () => {
  let proxy: Server | undefined;
  let port: number;
  let resolve: ReturnType<typeof vi.fn<Resolve>>;
  let lines: string[];
  // Stands in for the internet: an echo server on loopback, which the proxy reaches only through `dial`.
  let upstream: ReturnType<typeof createTcpServer>;
  let upstreamPort: number;
  let dialled: string[];
  const dial: Dial = (address, target) => {
    dialled.push(`${address}:${String(target)}`);
    return connect(upstreamPort, '127.0.0.1');
  };

  async function start(options: ProxyOptions = {}): Promise<void> {
    proxy = createProxy({ resolve, dial, log: (line) => lines.push(line), ...options });
    await new Promise<void>((done) => proxy?.listen(0, '127.0.0.1', done));
    port = (proxy.address() as AddressInfo).port;
  }

  beforeEach(async () => {
    resolve = vi.fn<Resolve>();
    lines = [];
    dialled = [];
    upstream = createTcpServer((socket) => socket.pipe(socket));
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
    upstreamPort = (upstream.address() as AddressInfo).port;
    await start();
  });

  afterEach(async () => {
    proxy?.closeAllConnections();
    await new Promise((done) => proxy?.close(done));
    await new Promise((done) => upstream.close(done));
  });

  /** Opens a CONNECT tunnel and resolves with the proxy's status line and the socket, still open. */
  function open(target: string): Promise<{ status: string; socket: Socket }> {
    return new Promise((done, fail) => {
      const socket = connect(port, '127.0.0.1', () =>
        socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
      );
      let answer = '';
      const onData = (chunk: Buffer) => {
        answer += chunk.toString();
        if (!answer.includes('\r\n\r\n')) return;
        socket.off('data', onData);
        done({ status: answer.split('\r\n')[0] ?? '', socket });
      };
      socket.on('data', onData);
      socket.on('error', fail);
    });
  }

  const echo = (socket: Socket, text: string) =>
    new Promise<string>((done) => {
      socket.once('data', (chunk: Buffer) => {
        done(chunk.toString());
      });
      socket.write(text);
    });

  const closed = (socket: Socket) =>
    new Promise<void>((done) => {
      if (socket.destroyed) done();
      else
        socket.once('close', () => {
          done();
        });
    });

  /** Sends raw text and returns the proxy's first line. */
  function send(text: string): Promise<string> {
    return new Promise((done, fail) => {
      const socket = connect(port, '127.0.0.1', () => socket.write(text));
      let answer = '';
      socket.on('data', (chunk) => {
        answer += chunk.toString();
        if (answer.includes('\r\n')) {
          socket.destroy();
          done(answer.split('\r\n')[0] ?? '');
        }
      });
      socket.on('error', fail);
    });
  }

  it('refuses hosts that are not allowed, without even resolving them', async () => {
    expect(await send('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n')).toBe(
      'HTTP/1.1 403 Forbidden',
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(lines).toEqual(['refused CONNECT: host example.com not allowed']);
  });

  it('refuses an allowed name that resolves to a private address (DNS rebinding)', async () => {
    // Something listening locally that must never be reached.
    let reached = false;
    const local = createServer(() => {
      reached = true;
    });
    await new Promise<void>((done) => local.listen(0, '127.0.0.1', done));
    resolve.mockResolvedValue(['127.0.0.1', '10.0.0.1']);
    expect(await send('CONNECT github.com:443 HTTP/1.1\r\n\r\n')).toBe('HTTP/1.1 403 Forbidden');
    expect(reached).toBe(false);
    expect(lines).toEqual(['refused CONNECT github.com: not a public address']);
    await new Promise((done) => local.close(done));
  });

  it('answers 502 when the name does not resolve', async () => {
    resolve.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await send('CONNECT github.com:443 HTTP/1.1\r\n\r\n')).toBe('HTTP/1.1 502 Bad Gateway');
  });

  it('refuses plain HTTP requests', async () => {
    expect(await send('GET http://github.com/ HTTP/1.1\r\nHost: github.com\r\n\r\n')).toBe(
      'HTTP/1.1 403 Forbidden',
    );
  });

  it('tunnels to the address it checked, both ways', async () => {
    resolve.mockResolvedValue(['10.0.0.9', '140.82.112.3']);
    const { status, socket } = await open('github.com:443');
    expect(status).toBe('HTTP/1.1 200 Connection Established');
    // The private answer is skipped; the public one is dialled.
    expect(dialled).toEqual(['140.82.112.3:443']);
    expect(await echo(socket, 'tls bytes')).toBe('tls bytes');
    expect(lines).toEqual(['allowed CONNECT github.com']);
    socket.destroy();
  });

  it('answers 502 when the upstream refuses, before any tunnel opens', async () => {
    resolve.mockResolvedValue(['140.82.112.3']);
    // A port with nothing listening on it.
    await new Promise((done) => upstream.close(done));
    upstream = createTcpServer();
    expect(await send('CONNECT github.com:443 HTTP/1.1\r\n\r\n')).toBe('HTTP/1.1 502 Bad Gateway');
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  });

  it('limits tunnels per workspace and in total, and frees a slot when one closes', async () => {
    await new Promise((done) => proxy?.close(done));
    await start({ limits: { tunnelsPerClient: 2, tunnels: 3 } });
    resolve.mockResolvedValue(['140.82.112.3']);
    const first = await open('github.com:443');
    const second = await open('registry.npmjs.org:443');
    expect([first.status, second.status]).toEqual([
      'HTTP/1.1 200 Connection Established',
      'HTTP/1.1 200 Connection Established',
    ]);
    expect((await open('github.com:443')).status).toBe('HTTP/1.1 429 Too Many Requests');
    expect(lines).toContain('refused CONNECT github.com: too many tunnels');
    first.socket.destroy();
    await closed(first.socket);
    await vi.waitFor(async () => {
      const again = await open('github.com:443');
      expect(again.status).toBe('HTTP/1.1 200 Connection Established');
      again.socket.destroy();
    });
    second.socket.destroy();
  });

  it('closes a connection that never sends its CONNECT line', async () => {
    await new Promise((done) => proxy?.close(done));
    await start({ limits: { headersMs: 200 } });
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => undefined);
    // Read what comes back (a 408), so the socket sees the end and closes.
    socket.resume();
    socket.write('CONNECT github.com:443 HTTP/1.1\r\n');
    const started = Date.now();
    await closed(socket);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('closes an idle tunnel', async () => {
    await new Promise((done) => proxy?.close(done));
    await start({ limits: { idleMs: 200 } });
    resolve.mockResolvedValue(['140.82.112.3']);
    const { status, socket } = await open('github.com:443');
    expect(status).toBe('HTTP/1.1 200 Connection Established');
    await closed(socket);
  });
});
