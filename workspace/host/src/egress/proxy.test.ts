import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTarget, createProxy, isPublicAddress, type Resolve } from './proxy.js';

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
  let proxy: Server;
  let port: number;
  let resolve: ReturnType<typeof vi.fn<Resolve>>;
  let lines: string[];

  beforeEach(async () => {
    resolve = vi.fn<Resolve>();
    lines = [];
    proxy = createProxy({ resolve, log: (line) => lines.push(line) });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    port = (proxy.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise((done) => proxy.close(done));
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
});
