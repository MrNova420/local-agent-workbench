import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WorkerCommand, WorkerEvent, WorkerResponse } from './shared/protocol';

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

  onEvent(listener: (event: WorkerEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: WorkerEvent) { for (const listener of this.listeners) listener(event); }

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
            this.emit(message.event as WorkerEvent);
          }
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (part: string) => {
        const text = String(part).trim();
        if (text) this.emit({ type: 'service_log', text: text.slice(0, 2000) });
      });
      child.once('error', (error) => {
        clearTimeout(launchTimer); this.child = undefined;
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear(); reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(launchTimer); this.child = undefined;
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
    const promise = new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject }));
    this.child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    return promise;
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
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = MAIN_WINDOW_VITE_DEV_SERVER_URL && url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    if (!allowed && !url.startsWith('agent-workbench://app/')) event.preventDefault();
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void mainWindow.loadURL('agent-workbench://app/index.html');
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

app.whenReady().then(async () => {
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
  ipcMain.handle('app:reveal-path', async (event, value: unknown) => {
    assertTrusted(event);
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Expected an absolute path.');
    await shell.openPath(value);
  });
  createWindow();
  void service.start().catch((error: Error) => mainWindow?.webContents.send('agent:event', { type: 'service_error', error: error.message }));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void service.shutdown().finally(() => app.exit(0));
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
