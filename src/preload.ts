import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, WorkerCommand, WorkerEvent } from './shared/protocol';

const api: DesktopApi = {
  request: <T>(command: WorkerCommand) => ipcRenderer.invoke('agent:request', command) as Promise<T>,
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
  chooseModelFile: () => ipcRenderer.invoke('app:choose-model-file') as Promise<string | null>,
  chooseLlamaBinary: () => ipcRenderer.invoke('app:choose-llama-binary') as Promise<string | null>,
  chooseModelDirectory: () => ipcRenderer.invoke('app:choose-model-directory') as Promise<string | null>,
  revealPath: (path) => ipcRenderer.invoke('app:reveal-path', path) as Promise<void>,
  version: process.env.npm_package_version ?? '0.1.0',
};

contextBridge.exposeInMainWorld('agent', api);
