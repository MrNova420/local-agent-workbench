import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import path from 'node:path';

const config: ForgeConfig = {
  outDir: process.env.LOCAL_AGENT_OUT_DIR || 'out',
  packagerConfig: {
    asar: true,
    extraResource: [path.resolve(process.env.LOCAL_AGENT_WORKER_OUT_DIR || 'sidecar/dist', 'agent-worker.exe')],
  },
  makers: [
    new MakerSquirrel({ name: 'LocalAgentWorkbench' }),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new VitePlugin({
      concurrent: 1,
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
};

export default config;
