/**
 * Locality helpers shared by the capture pipeline's two network stages
 * (transcription upload and completion). Where bytes go is a property of the
 * resolved endpoint host, not the provider label, so both stages classify
 * locality the same way instead of trusting a static `location` field.
 */

/** Whether a base URL points at this machine (loopback host). */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
	try {
		const hostname = new URL(baseUrl).hostname;
		return (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname === '[::1]'
		);
	} catch {
		return false;
	}
}

/** The host (with port) of a base URL, or the raw string when it won't parse. */
export function hostFromBaseUrl(baseUrl: string): string {
	try {
		return new URL(baseUrl).host;
	} catch {
		return baseUrl;
	}
}
