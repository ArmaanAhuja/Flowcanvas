// The workspace's file changes, live (phase 3 step 7, ADR 0022): a WebSocket to
// /api/projects/:id/workspace/events while the workspace runs, reconnecting after a drop. Every event was checked
// by the host and the control plane; the page checks its shape again.
import { useEffect, useRef } from 'react';

export type DiskEvent =
  | {
      readonly type: 'changed';
      readonly path: string;
      readonly deleted: boolean;
      readonly version: string | null;
    }
  /** Too much changed at once, or the connection dropped and came back: re-check everything. */
  | { readonly type: 'overflow' };

export function parseDiskEvent(text: unknown): DiskEvent | undefined {
  if (typeof text !== 'string') return undefined;
  try {
    const event = JSON.parse(text) as Record<string, unknown>;
    if (event.type === 'overflow') return { type: 'overflow' };
    if (
      event.type === 'changed' &&
      typeof event.path === 'string' &&
      typeof event.deleted === 'boolean' &&
      (event.version === null || typeof event.version === 'string')
    ) {
      return { type: 'changed', path: event.path, deleted: event.deleted, version: event.version };
    }
  } catch {
    // Not an event.
  }
  return undefined;
}

/** Waits between reconnection attempts, growing; the last one repeats. */
export const RECONNECT_MS = [1000, 2000, 5000, 10_000] as const;

export type OpenSocket = (url: string) => WebSocket;

const defaultOpen: OpenSocket = (url) => new WebSocket(url);

export function eventsUrl(projectId: string, where: Location = window.location): string {
  return `${where.protocol === 'https:' ? 'wss' : 'ws'}://${where.host}/api/projects/${encodeURIComponent(projectId)}/workspace/events`;
}

/** Calls `onEvent` for every change in the workspace while `running`; after a reconnect, once with `overflow`. */
export function useWorkspaceEvents(
  projectId: string,
  running: boolean,
  onEvent: (event: DiskEvent) => void,
  open: OpenSocket = defaultOpen,
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!running) return;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;
    let connectedBefore = false;
    const connect = () => {
      socket = open(eventsUrl(projectId));
      socket.addEventListener('open', () => {
        attempts = 0;
        // Changes made while disconnected weren't reported: re-check.
        if (connectedBefore) handler.current({ type: 'overflow' });
        connectedBefore = true;
      });
      socket.addEventListener('message', ({ data }) => {
        const event = parseDiskEvent(data);
        if (event !== undefined) handler.current(event);
      });
      socket.addEventListener('close', () => {
        if (stopped) return;
        const wait = RECONNECT_MS[Math.min(attempts, RECONNECT_MS.length - 1)];
        attempts += 1;
        timer = setTimeout(connect, wait);
      });
    };
    connect();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      socket?.close(1000, 'page left');
    };
  }, [projectId, running, open]);
}

/** SHA-256 of text as UTF-8, in hex: the version the workspace will report for a file with this content. */
export async function versionOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
