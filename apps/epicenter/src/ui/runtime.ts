/** Whether local-model controls may call the desktop host. */

import { isTauri } from '@tauri-apps/api/core';

/** Whether this model-administration document can call the desktop host. */
export function isDesktopHost(): boolean {
	return isTauri();
}
