// The one bridge between the page and the app (build plan v2, phase 1): the page runs sandboxed, with no Node, and
// can only ask for what's listed here. CommonJS, as Electron requires for a sandboxed preload.
// A CommonJS file under verbatimModuleSyntax can only import this way (a sandboxed preload must be CommonJS).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld('flowcanvasDesktop', {
  /** Shows the system's folder picker; the opened project's id, or null when cancelled. */
  openFolder: (): Promise<{ readonly id: string } | null> =>
    ipcRenderer.invoke('flowcanvas:open-folder') as Promise<{ readonly id: string } | null>,
});
