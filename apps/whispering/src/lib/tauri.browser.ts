import type { Tauri } from './tauri.tauri';

/** Native capabilities are unavailable in the standalone web build. */
export const tauri: Tauri | null = null;

export type { Tauri };
