import type { CortexAPI } from '../../electron/preload';

declare global {
  interface Window {
    cortex: CortexAPI;
  }
}

export {};
