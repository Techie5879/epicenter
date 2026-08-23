/**
 * Vocab's instance setting: which Epicenter star this install talks to
 * (ADR-0069/0070). The hosted default uses OAuth; a self-hoster overrides the
 * base URL and pastes the token their box minted (ADR-0071).
 *
 * The read/write/clear contract and the hosted-default invariant live in the
 * shared {@link createInstanceSetting}; this file only injects Vocab's storage
 * key and hosted base URL. `globalThis.localStorage` is `undefined` under SSR
 * import, where the handle reports the hosted default and persists nothing.
 */

import { createInstanceSetting } from '@epicenter/auth';
import { APP_URLS } from '@epicenter/constants/vite';

export const instanceSetting = createInstanceSetting({
	storageKey: 'vocab.instance',
	defaultBaseURL: APP_URLS.API,
	storage: globalThis.localStorage,
});
