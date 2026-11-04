// The terminal component's wiring, with xterm.js and the WebSocket replaced (xterm needs a real browser to
// draw; the walkthrough checks that under the deployed CSP).
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES, WorkspaceTerminal, terminalUrl } from './WorkspaceTerminal';

const { FakeTerminal, terminals } = vi.hoisted(() => {
  const terminals: InstanceType<typeof FakeTerminal>[] = [];
  class FakeTerminal {
    cols = 80;
    rows = 24;
    written: Uint8Array[] = [];
    disposed = false;
    readonly options: unknown;
    #onData: ((data: string) => void) | undefined;
    #onResize: ((size: { cols: number; rows: number }) => void) | undefined;
    constructor(options: unknown) {
      this.options = options;
      terminals.push(this);
    }
    // The real ones draw; these record nothing.
    loadAddon() {
      return undefined;
    }
    open() {
      return undefined;
    }
    focus() {
      return undefined;
    }
    write(data: Uint8Array) {
      this.written.push(data);
    }
    onData(listener: (data: string) => void) {
      this.#onData = listener;
      return { dispose: () => undefined };
    }
    onResize(listener: (size: { cols: number; rows: number }) => void) {
      this.#onResize = listener;
      return { dispose: () => undefined };
    }
    dispose() {
      this.disposed = true;
    }
    type(data: string) {
      this.#onData?.(data);
    }
    resize(cols: number, rows: number) {
      this.#onResize?.({ cols, rows });
    }
  }

  return { FakeTerminal, terminals };
});

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {
      return undefined;
    }
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

class FakeSocket extends EventTarget {
  readonly OPEN = 1;
  readyState = 0;
  binaryType = 'blob';
  sent: unknown[] = [];
  closed = false;
  constructor(readonly url: string) {
    super();
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  receive(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  end() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

let sockets: FakeSocket[];
const openSocket = (url: string) => {
  const socket = new FakeSocket(url);
  sockets.push(socket);
  return socket as unknown as WebSocket;
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  sockets = [];
  terminals.length = 0;
});

function show() {
  return render(<WorkspaceTerminal projectId="p-1" projectName="Rallly" openSocket={openSocket} />);
}

describe('terminalUrl', () => {
  it('uses wss on https and ws on http, on the page’s own origin', () => {
    expect(
      terminalUrl({ protocol: 'https:', host: 'app.example' } as Location, 'p 1', 80, 24),
    ).toBe('wss://app.example/api/projects/p%201/workspace/terminal?cols=80&rows=24');
    expect(
      terminalUrl({ protocol: 'http:', host: 'localhost:5173' } as Location, 'p', 100, 30),
    ).toBe('ws://localhost:5173/api/projects/p/workspace/terminal?cols=100&rows=30');
  });
});

describe('WorkspaceTerminal', () => {
  it('connects at the terminal’s size, with bytes as ArrayBuffers', () => {
    show();
    expect(sockets[0]?.url).toMatch(/\/api\/projects\/p-1\/workspace\/terminal\?cols=80&rows=24$/);
    expect(sockets[0]?.binaryType).toBe('arraybuffer');
    expect(screen.getByRole('status').textContent).toBe(MESSAGES.connecting);
    act(() => sockets[0]?.open());
    expect(screen.getByRole('status').textContent).toBe(MESSAGES.open);
  });

  it('sends typing as bytes and size changes as JSON; writes what comes back', () => {
    show();
    const socket = sockets[0];
    act(() => socket?.open());
    terminals[0]?.type('ls\r');
    terminals[0]?.resize(120, 40);
    expect(socket?.sent).toEqual([
      new TextEncoder().encode('ls\r'),
      '{"type":"resize","cols":120,"rows":40}',
    ]);
    act(() => socket?.receive(new TextEncoder().encode('package.json\r\n').buffer));
    expect(new TextDecoder().decode(terminals[0]?.written[0])).toBe('package.json\r\n');
  });

  it('says how the shell ended, and starts a new one on request', async () => {
    show();
    act(() => {
      sockets[0]?.open();
      sockets[0]?.receive('{"type":"exit","code":3}');
      sockets[0]?.end();
    });
    expect(screen.getByRole('status').textContent).toBe(MESSAGES.ended(3));
    await userEvent.click(screen.getByRole('button', { name: 'Start a new terminal' }));
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.closed).toBe(true);
    expect(terminals[0]?.disposed).toBe(true);
  });

  it('explains a connection that never opened', () => {
    show();
    act(() => sockets[0]?.end());
    expect(screen.getByRole('status').textContent).toBe(MESSAGES.failed);
    expect(screen.getByRole('button', { name: 'Start a new terminal' })).toBeTruthy();
  });

  it('shows the workspace’s notices without ending', () => {
    show();
    act(() => {
      sockets[0]?.open();
      sockets[0]?.receive('{"type":"error","message":"Unknown control message."}');
    });
    expect(screen.getByRole('status').textContent).toBe('Unknown control message.');
    expect(screen.queryByRole('button', { name: 'Start a new terminal' })).toBeNull();
  });

  it('takes its colours and font from the design tokens', () => {
    document.documentElement.style.setProperty('--color-surface-canvas', '#0B0C0E');
    document.documentElement.style.setProperty('--text-mono-font-size', '12px');
    show();
    expect(terminals[0]?.options).toMatchObject({ fontSize: 12, theme: { background: '#0B0C0E' } });
  });

  it('closes the connection and the terminal when it goes away', () => {
    const { unmount } = show();
    unmount();
    expect(sockets[0]?.closed).toBe(true);
    expect(terminals[0]?.disposed).toBe(true);
  });
});
