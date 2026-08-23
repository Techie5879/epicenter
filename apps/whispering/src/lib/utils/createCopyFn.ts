import type { CopyFn } from '@epicenter/ui/copy-button';
import { report } from '$lib/report';
import { services } from '$lib/services';

/**
 * Creates a copy function with toast notifications.
 *
 * @param contentDescription - Description of what's being copied (e.g., "transcript", "API key")
 *                            Used in toast messages like "Copied {contentDescription} to clipboard!"
 *
 * @example
 * ```svelte
 * <CopyButton
 *   text={transcribedText}
 *   copyFn={createCopyFn('transcript')}
 * >
 *   <CopyIcon class="size-4" />
 * </CopyButton>
 * ```
 */
export function createCopyFn(contentDescription: string): CopyFn {
	return async (text: string) => {
		const { error } = await services.text.copyToClipboard(text);
		if (error) {
			report.error({
				title: `Error copying ${contentDescription} to clipboard`,
				cause: error,
			});
			throw error;
		}
		report.success({
			title: `Copied ${contentDescription} to clipboard!`,
			description: text,
		});
	};
}
