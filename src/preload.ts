import { contextBridge, ipcRenderer } from 'electron';
import type { AppUpdateState, DesktopApi, WorkerCommand, WorkerEvent } from './shared/protocol';

const api: DesktopApi = {
  request: <T>(command: WorkerCommand) => ipcRenderer.invoke('agent:request', command) as Promise<T>,
  windowControl: (action) => ipcRenderer.invoke('app:window-control', action) as Promise<void>,
  windowState: () => ipcRenderer.invoke('app:window-state') as Promise<boolean>,
  onWindowState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized);
    ipcRenderer.on('app:window-state', handler);
    return () => ipcRenderer.removeListener('app:window-state', handler);
  },
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: WorkerEvent) => listener(payload);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.removeListener('agent:event', handler);
  },
  onCloseDecision: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('app:close-decision-required', handler);
    return () => ipcRenderer.removeListener('app:close-decision-required', handler);
  },
  resolveCloseChoice: (choice) => ipcRenderer.invoke('app:resolve-close-choice', choice) as Promise<void>,
  chooseWorkspace: () => ipcRenderer.invoke('app:choose-workspace') as Promise<string | null>,
  chooseExternalDirectory: () => ipcRenderer.invoke('app:choose-external-directory') as Promise<string | null>,
  chooseModelFile: () => ipcRenderer.invoke('app:choose-model-file') as Promise<string | null>,
  chooseLlamaBinary: () => ipcRenderer.invoke('app:choose-llama-binary') as Promise<string | null>,
  chooseModelDirectory: () => ipcRenderer.invoke('app:choose-model-directory') as Promise<string | null>,
  revealPath: (path) => ipcRenderer.invoke('app:reveal-path', path) as Promise<void>,
  openOllamaDownload: () => ipcRenderer.invoke('app:open-ollama-download') as Promise<void>,
  updateState: () => ipcRenderer.invoke('app:update-state') as Promise<AppUpdateState>,
  onUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppUpdateState) => listener(state);
    ipcRenderer.on('app:update-state', handler);
    return () => ipcRenderer.removeListener('app:update-state', handler);
  },
  checkForUpdate: () => ipcRenderer.invoke('app:check-update') as Promise<AppUpdateState>,
  installUpdate: () => ipcRenderer.invoke('app:install-update') as Promise<{ installed: boolean; reason?: string }>,
  version: process.env.npm_package_version ?? '0.1.0',
};

contextBridge.exposeInMainWorld('agent', api);
