import type { EllaApi } from '../shared/ipc.ts';

declare global {
  interface Window {
    ella: EllaApi;
  }
}

export {};
