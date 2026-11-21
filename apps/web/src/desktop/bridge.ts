// The desktop app's bridge (build plan v2, phase 1): present only when the page runs in Flowcanvas for Linux, whose
// preload exposes it. The site and the tests run without it, unchanged.

export interface DesktopBridge {
  /** Shows the system's folder picker; the opened project's id, or null when cancelled. */
  openFolder(): Promise<{ readonly id: string } | null>;
}

/** The bridge, or undefined outside the desktop app. */
export function desktopBridge(): DesktopBridge | undefined {
  const bridge = (window as { flowcanvasDesktop?: unknown }).flowcanvasDesktop;
  return typeof bridge === 'object' &&
    bridge !== null &&
    typeof (bridge as Partial<DesktopBridge>).openFolder === 'function'
    ? (bridge as DesktopBridge)
    : undefined;
}
