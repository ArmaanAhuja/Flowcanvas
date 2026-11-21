// Flowcanvas for Linux (build plan v2, phase 1): an Electron window on the local server, which answers the web app's
// routes from the user's own folders. Started from the app menu, or as `flowcanvas <folder>` to open one directly.
import { join, resolve } from 'node:path';
import electron from 'electron';
import { Folders } from './folders.js';
import { Projects } from './projects.js';
import { listedFiles, RunService } from './run/service.js';
import { nodePty } from './run/terminal.js';
import { startDesktopServer, type DesktopServer } from './server.js';
import { smokeTest } from './smoke.js';

// Electron's module is CommonJS: a default import, not named ones, works from an ES module main.
const { app, BrowserWindow, dialog, ipcMain, shell } = electron;
type BrowserWindow = electron.BrowserWindow;

/** The IPC channel the start screen's "Open folder" uses. */
export const OPEN_FOLDER = 'flowcanvas:open-folder';

/** Where the built web app and the engine bundle are: beside the app when installed, in build/ while developing. */
function resources() {
  const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build');
  return {
    webRoot: join(root, 'web'),
    engineMain: join(root, 'engine', 'main.js'),
    preload: join(app.getAppPath(), 'build', 'app', 'preload.cjs'),
  };
}

/** A folder given on the command line (`flowcanvas ~/code/my-app`), or none. */
function folderArgument(argv: readonly string[]): string | undefined {
  // After the executable: not a flag, and not the app itself (`electron <app folder>` while developing). Tools that
  // start the app put flags of their own anywhere, so positions can't be relied on.
  const own = resolve(app.getAppPath());
  return argv
    .slice(1)
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => resolve(arg))
    .find((path) => path !== own);
}

let server: DesktopServer | undefined;
let folders: Folders | undefined;
let run: RunService | undefined;

async function main(): Promise<void> {
  // One window per machine: opening Flowcanvas again (or `flowcanvas <folder>`) focuses it instead.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  const paths = resources();
  const projects = new Projects({ dataRoot: app.getPath('userData') });
  folders = new Folders({
    engineMain: paths.engineMain,
    dataFolder: (ref) => {
      const project = projects.list().find((p) => p.path === ref);
      return projects.dataFolder(project?.id ?? 'unlisted');
    },
  });
  const local = folders;
  run = new RunService({
    files: async (root) => {
      const answer = await local.agent(root, { op: 'files' });
      return answer.ok ? listedFiles(answer.result) : [];
    },
  });
  server = await startDesktopServer({
    projects,
    folders,
    run,
    openPty: nodePty,
    webRoot: paths.webRoot,
  });

  if (process.argv.includes('--smoke-test')) {
    const folder = folderArgument(process.argv);
    const ok = await smokeTest({ server, projects, folders, folder });
    app.exit(ok ? 0 : 1);
    return;
  }

  const startAt = (folder: string | undefined) =>
    folder === undefined ? '/' : `/p/${projects.open(folder).id}`;
  const window = createWindow(server, paths.preload, startAt(folderArgument(process.argv)));
  app.on('second-instance', (_event, argv) => {
    const folder = folderArgument(argv);
    if (folder !== undefined && server !== undefined) {
      void window.loadURL(server.entryUrl(startAt(folder)));
    }
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  ipcMain.handle(OPEN_FOLDER, async (event) => {
    // Only our own page may ask.
    if (server === undefined || !event.senderFrame?.url.startsWith(`${server.origin}/`))
      return null;
    const chosen = await dialog.showOpenDialog(window, {
      title: 'Open a project folder',
      properties: ['openDirectory'],
    });
    const folder = chosen.filePaths[0];
    if (chosen.canceled || folder === undefined) return null;
    return { id: projects.open(folder).id };
  });
}

function createWindow(local: DesktopServer, preload: string, path: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Flowcanvas',
    backgroundColor: '#0b0c0e',
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Our pages stay in the window; links elsewhere open in the person's browser, never inside the app.
  const ours = (url: string) => url.startsWith(`${local.origin}/`);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !ours(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (ours(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  void window.loadURL(local.entryUrl(path));
  return window;
}

app.on('window-all-closed', () => {
  app.quit();
});
let quitting = false;
app.on('will-quit', (event) => {
  // The project's processes are stopped first (everything they started too): nothing keeps running that the person
  // didn't start, once the app is closed.
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void (run?.stopAll() ?? Promise.resolve()).finally(() => {
    folders?.close();
    void server?.close();
    app.exit(0);
  });
});

void main();
