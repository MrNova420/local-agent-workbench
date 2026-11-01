import { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, Tray } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicWindowsUpdateFeed } from './shared/update-feed';
import type { WorkerCommand, WorkerEvent, WorkerResponse } from './shared/protocol';

// Squirrel invokes the app during install/update/uninstall. Handle those
// lifecycle launches before creating a window or starting the sidecar.
const isSquirrelLifecycle = Boolean(squirrelStartup);
if (isSquirrelLifecycle) app.quit();
const hasSingleInstanceLock = isSquirrelLifecycle ? false : app.requestSingleInstanceLock();
if (!isSquirrelLifecycle && !hasSingleInstanceLock) app.quit();

protocol.registerSchemesAsPrivileged([
  { scheme: 'agent-workbench', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
]);

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

class AgentWorker {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private pending = new Map<string, Pending>();
  private listeners = new Set<(event: WorkerEvent) => void>();
  private starting?: Promise<void>;
  private runActive = false;
  private idleWaiters = new Set<() => void>();

  onEvent(listener: (event: WorkerEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: WorkerEvent) { for (const listener of this.listeners) listener(event); }
  isRunActive() { return this.runActive; }
  private markIdle() { this.runActive = false; for (const resolve of this.idleWaiters) resolve(); this.idleWaiters.clear(); }
  waitForRunIdle() { return this.runActive ? new Promise<void>((resolve) => this.idleWaiters.add(resolve)) : Promise.resolve(); }

  start() {
    if (this.child) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const packagedExe = path.join(process.resourcesPath, 'agent-worker.exe');
      const workerScript = path.join(app.getAppPath(), 'sidecar', 'worker.py');
      const corePath = process.env.LOCAL_AGENT_CORE_PATH || path.resolve(app.getAppPath(), '..', 'local-9b-dev-app');
      const packaged = app.isPackaged;
      if (packaged && !existsSync(packagedExe)) { reject(new Error(`Agent sidecar missing: ${packagedExe}`)); return; }
      const command = packaged ? packagedExe : (process.env.AGENT_PYTHON || 'python');
      const args = packaged ? [] : ['-u', workerScript];
      const child = spawn(command, args, {
        cwd: packaged ? path.dirname(packagedExe) : app.getAppPath(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LOCAL_AGENT_CORE_PATH: corePath, PYTHONUNBUFFERED: '1' },
      });
      this.child = child;
      let ready = false;
      let launchTimer = setTimeout(() => {
        if (ready) return;
        this.emit({ type: 'service_error', error: 'Python agent sidecar did not become ready within 15 seconds.' });
        if (this.child === child) this.child = undefined;
        child.kill();
        reject(new Error('Python agent sidecar did not become ready within 15 seconds.'));
      }, 15000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (part: string) => {
        this.buffer += part;
        for (;;) {
          const end = this.buffer.indexOf('\n');
          if (end < 0) break;
          const line = this.buffer.slice(0, end).trim();
          this.buffer = this.buffer.slice(end + 1);
          if (!line) continue;
          let message: Record<string, unknown>;
          try { message = JSON.parse(line) as Record<string, unknown>; }
          catch { this.emit({ type: 'service_error', error: 'Agent service sent invalid protocol data.' }); continue; }
          if (message.type === 'ready') {
            ready = true; clearTimeout(launchTimer); resolve(); this.emit({ type: 'service_ready' });
          } else if (message.type === 'response' && typeof message.id === 'string') {
            const entry = this.pending.get(message.id);
            if (entry) {
              this.pending.delete(message.id);
              const response = message as unknown as WorkerResponse;
              response.ok ? entry.resolve(response.data) : entry.reject(new Error(response.error || 'Agent service request failed.'));
            }
          } else if (message.type === 'event') {
            const agentEvent = message.event as WorkerEvent;
            if (agentEvent.type === 'run_idle') this.markIdle();
            this.emit(agentEvent);
          }
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (part: string) => {
        const text = String(part).trim();
        if (text) this.emit({ type: 'service_log', text: text.slice(0, 2000) });
      });
      child.once('error', (error) => {
        clearTimeout(launchTimer); this.child = undefined; this.markIdle();
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear(); reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(launchTimer); this.child = undefined; this.markIdle();
        const exitLabel = signal || (code ?? 'unknown');
        const error = new Error(`Agent service exited (${exitLabel}).`);
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear(); this.emit({ type: 'service_exit', error: error.message });
        if (!ready) reject(error);
      });
    }).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  async request<T = unknown>(command: WorkerCommand): Promise<T> {
    await this.start();
    if (!this.child?.stdin.writable) throw new Error('Agent service is not available.');
    const id = randomUUID();
    if (command.command === 'run_start') this.runActive = true;
    const promise = new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject }));
    this.child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    return promise.catch((error) => { if (command.command === 'run_start') this.markIdle(); throw error; });
  }

  async shutdown() {
    const child = this.child;
    if (!child) return;
    try { await Promise.race([this.request({ command: 'shutdown' }), new Promise((resolve) => setTimeout(resolve, 4000))]); } catch { /* already exiting */ }
    if (this.child === child) child.kill();
    this.child = undefined;
  }
}

const service = new AgentWorker();
let mainWindow: BrowserWindow | undefined;
let quitting = false;
let closeDecisionPending = false;
let tray: Tray | undefined;
const updateState = {
  supported: false,
  status: 'unsupported' as 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error',
  currentVersion: app.getVersion(),
  releaseName: undefined as string | undefined,
  error: undefined as string | undefined,
};
let updaterStarted = false;
let updateCheckInProgress = false;

function publishUpdateState(patch: Partial<typeof updateState>) {
  Object.assign(updateState, patch);
  mainWindow?.webContents.send('app:update-state', { ...updateState });
}

function checkForUpdateNow() {
  if (!updaterStarted || !updateState.supported) return { ...updateState };
  if (updateCheckInProgress) return { ...updateState };
  updateCheckInProgress = true;
  publishUpdateState({ status: 'checking', error: undefined });
  try { autoUpdater.checkForUpdates(); }
  catch (error) { updateCheckInProgress = false; publishUpdateState({ status: 'error', error: (error as Error).message }); }
  return { ...updateState };
}

function startUpdateChecks() {
  const squirrelUpdateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const feed = publicWindowsUpdateFeed(app.getVersion(), process.platform, process.arch, existsSync(squirrelUpdateExe));
  if (!app.isPackaged || !feed) return;
  updateState.supported = true;
  updateState.status = 'idle';
  // Squirrel holds a lock briefly after a first install; wait before contacting
  // the public GitHub release feed.
  const firstRun = process.argv.includes('--squirrel-firstrun');
  autoUpdater.setFeedURL({ url: feed });
  autoUpdater.on('checking-for-update', () => { updateCheckInProgress = true; publishUpdateState({ status: 'checking', error: undefined }); });
  autoUpdater.on('update-available', () => publishUpdateState({ status: 'downloading', error: undefined }));
  autoUpdater.on('update-not-available', () => { updateCheckInProgress = false; publishUpdateState({ status: 'not-available', releaseName: undefined, error: undefined }); });
  autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => { updateCheckInProgress = false; publishUpdateState({ status: 'downloaded', releaseName: String(releaseName || 'New version'), error: undefined }); });
  autoUpdater.on('error', (error) => { updateCheckInProgress = false; publishUpdateState({ status: 'error', error: error.message || String(error) }); });
  updaterStarted = true;
  const checkWhenIdle = () => { if (!service.isRunActive()) checkForUpdateNow(); };
  setTimeout(checkWhenIdle, firstRun ? 12000 : 18000).unref();
  setInterval(checkWhenIdle, 6 * 60 * 60 * 1000).unref();
}

function requestCloseDecision() {
  if (!mainWindow || closeDecisionPending) return;
  closeDecisionPending = true;
  mainWindow.webContents.send('app:close-decision-required');
}

async function ensureTray() {
  if (tray) return;
  const icon = await app.getFileIcon(process.execPath, { size: 'small' });
  tray = new Tray(icon);
  tray.setToolTip('Local Agent Workbench · task continues in background');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Local Agent Workbench', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { if (service.isRunActive()) requestCloseDecision(); else app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function trustedSender(frame: Electron.WebFrameMain | null) {
  if (!frame || !mainWindow || frame !== mainWindow.webContents.mainFrame) return false;
  const actual = new URL(frame.url);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return actual.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
  return actual.protocol === 'agent-workbench:' && actual.host === 'app';
}

function assertTrusted(event: Electron.IpcMainInvokeEvent) {
  if (!trustedSender(event.senderFrame)) throw new Error('Blocked IPC request from an untrusted frame.');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1510, height: 990, minWidth: 1080, minHeight: 700,
    backgroundColor: '#080B12', title: 'Local Agent Workbench',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0B101B', symbolColor: '#DCE6F2', height: 42 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('close', (event) => {
    if (quitting || !service.isRunActive()) return;
    event.preventDefault();
    requestCloseDecision();
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = MAIN_WINDOW_VITE_DEV_SERVER_URL && url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    if (!allowed && !url.startsWith('agent-workbench://app/')) event.preventDefault();
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void mainWindow.loadURL('agent-workbench://app/index.html');
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

if (hasSingleInstanceLock) app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });

app.whenReady().then(async () => {
  if (isSquirrelLifecycle || !hasSingleInstanceLock) return;
  app.setAppUserModelId('com.squirrel.LocalAgentWorkbench.LocalAgentWorkbench');
  protocol.handle('agent-workbench', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const root = path.resolve(app.getAppPath(), '.vite', 'renderer', 'main_window');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    try { return await net.fetch(pathToFileURL(file).toString()); }
    catch { return new Response('Not found', { status: 404 }); }
  });

  service.onEvent((event) => mainWindow?.webContents.send('agent:event', event));
  ipcMain.handle('agent:request', async (event, command: WorkerCommand) => { assertTrusted(event); return service.request(command); });
  ipcMain.handle('app:choose-workspace', async (event) => {
    assertTrusted(event);
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: 'Choose a project workspace' });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('app:choose-model-file', async (event) => {
    assertTrusted(event);
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], title: 'Select a GGUF model', filters: [{ name: 'GGUF model', extensions: ['gguf'] }] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('app:choose-llama-binary', async (event) => {
    assertTrusted(event);
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], title: 'Select llama.cpp server', filters: [{ name: 'Windows executable', extensions: ['exe'] }] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('app:choose-model-directory', async (event) => {
    assertTrusted(event);
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: 'Select a local Safetensors model directory' });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('app:open-ollama-download', async (event) => {
    assertTrusted(event);
    await shell.openExternal('https://ollama.com/download/windows');
  });
  ipcMain.handle('app:update-state', (event) => { assertTrusted(event); return { ...updateState }; });
  ipcMain.handle('app:check-update', (event) => { assertTrusted(event); return service.isRunActive() ? { ...updateState } : checkForUpdateNow(); });
  ipcMain.handle('app:install-update', async (event) => {
    assertTrusted(event);
    if (service.isRunActive()) return { installed: false, reason: 'A task is still running. Finish or cancel it before applying an update.' };
    if (updateState.status !== 'downloaded') return { installed: false, reason: 'No downloaded update is ready to install.' };
    quitting = true;
    await service.shutdown();
    autoUpdater.quitAndInstall();
    return { installed: true };
  });
  ipcMain.handle('app:reveal-path', async (event, value: unknown) => {
    assertTrusted(event);
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Expected an absolute path.');
    await shell.openPath(value);
  });
  ipcMain.handle('app:resolve-close-choice', async (event, choice: unknown) => {
    assertTrusted(event);
    if (choice !== 'keep' && choice !== 'hide' && choice !== 'cancel-close') throw new Error('Invalid close choice.');
    closeDecisionPending = false;
    if (choice === 'keep') return;
    if (choice === 'hide') { await ensureTray(); mainWindow?.hide(); return; }
    if (service.isRunActive()) {
      try { await service.request({ command: 'run_cancel' }); } catch { /* the sidecar may have exited already */ }
      await service.waitForRunIdle();
    }
    quitting = true;
    void service.shutdown().finally(() => app.exit(0));
  });
  createWindow();
  startUpdateChecks();
  void service.start().catch((error: Error) => mainWindow?.webContents.send('agent:event', { type: 'service_error', error: error.message }));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', (event) => {
  if (quitting) return;
  if (service.isRunActive()) { event.preventDefault(); requestCloseDecision(); return; }
  event.preventDefault();
  quitting = true;
  void service.shutdown().finally(() => app.exit(0));
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
