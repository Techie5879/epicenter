import { AnalyticsServiceLive } from '#platform/analytics';
import { BlobSourcesLive, BlobsLive } from '#platform/blobs';
import { DownloadServiceLive } from '#platform/download';
import { customFetch } from '#platform/http';
import { TextServiceLive } from '#platform/text';
import { createCodexService } from './codex';
import { LocalShortcutManagerLive } from './local-shortcut-manager';
import { PlaySoundServiceLive } from './sound';

/**
 * Cross-platform services.
 * These are available on both web and desktop.
 */
export const services = {
	analytics: AnalyticsServiceLive,
	text: TextServiceLive,
	blobs: BlobsLive,
	blobSources: BlobSourcesLive,
	download: DownloadServiceLive,
	codex: createCodexService({ fetch: customFetch }),
	localShortcutManager: LocalShortcutManagerLive,
	sound: PlaySoundServiceLive,
} as const;
