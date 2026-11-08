import { createHash } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventsUrl, parseDiskEvent, useWorkspaceEvents, versionOf, type DiskEvent } from './events';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A WebSocket the test drives. */
class FakeSocket extends EventTarget {
  closed = false;
  constructor(readonly url: string) {
    super();
  }
  close() {
    this.closed = true;
  }
  open() {
    this.dispatchEvent(new Event('open'));
  }
  message(data: string) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  drop() {
    this.dispatchEvent(new Event('close'));
  }
}

describe('workspace events', () => {
  it('passes real change events on, and nothing else', () => {
    const version = 'a'.repeat(64);
    expect(
      parseDiskEvent(JSON.stringify({ type: 'changed', path: 'a.ts', deleted: false, version })),
    ).toEqual({
      type: 'changed',
      path: 'a.ts',
      deleted: false,
      version,
    });
    expect(parseDiskEvent('{"type":"overflow"}')).toEqual({ type: 'overflow' });
    for (const bad of [
      'nope',
      '{"type":"ready","folders":1,"files":1}',
      '{"type":"changed","path":1}',
      7,
    ]) {
      expect(parseDiskEvent(bad)).toBeUndefined();
    }
  });

  it('connects to the project’s events, and reconnects after a drop, then asks for a re-check', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const events: DiskEvent[] = [];
    const { unmount } = renderHook(() => {
      useWorkspaceEvents(
        'p 1',
        true,
        (event) => events.push(event),
        (url) => {
          const socket = new FakeSocket(url);
          sockets.push(socket);
          return socket as unknown as WebSocket;
        },
      );
    });
    expect(sockets[0]?.url).toBe(eventsUrl('p 1'));
    act(() => {
      sockets[0]?.open();
      sockets[0]?.message('{"type":"changed","path":"a.ts","deleted":true,"version":null}');
      sockets[0]?.drop();
    });
    expect(sockets).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(sockets).toHaveLength(2);
    act(() => {
      sockets[1]?.open();
    });
    expect(events).toEqual([
      { type: 'changed', path: 'a.ts', deleted: true, version: null },
      { type: 'overflow' },
    ]);
    unmount();
    expect(sockets[1]?.closed).toBe(true);
  });

  it('does not connect while the workspace is not running', () => {
    const open = vi.fn();
    renderHook(() => {
      useWorkspaceEvents('p', false, vi.fn(), open);
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('computes the version the workspace will report for some text (SHA-256 of its UTF-8)', async () => {
    for (const text of ['export const a = 1;\n', 'naïve “quotes” — 日本語\r\n', '']) {
      expect(await versionOf(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});
