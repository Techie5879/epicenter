import mime from 'mime';

/**
 * Gets the file extension for an audio MIME type, falling back to 'mp3' for unknown types.
 *
 * The `mime` library's `getExtension()` already strips parameters (e.g.,
 * `'audio/webm;codecs=opus'` → looks up `'audio/webm'`) and normalizes to lowercase,
 * so no manual pre-processing is needed.
 *
 * The 'mp3' fallback is intentional: transcription APIs (OpenAI, Groq, Mistral, etc.)
 * require a recognized audio extension to properly decode the file. MP3 is universally
 * supported and most APIs can auto-detect the actual format from the file contents.
 *
 * In practice, this fallback is rarely hit since audio blobs from MediaRecorder
 * always have valid MIME types like 'audio/webm' or 'audio/mp4'.
 */
export function getAudioExtension(mimeType: string): string {
	const extension = mime.getExtension(mimeType) ?? 'mp3';
	// The `mime` library returns technically correct but non-standard extensions
	// that transcription APIs don't recognize:
	// - 'weba' for audio/webm (should be 'webm')
	// - 'oga' for audio/ogg (should be 'ogg')
	// Groq/OpenAI/Mistral support: flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm
	const extensionMapping: Record<string, string> = {
		weba: 'webm',
		oga: 'ogg',
	};
	return extensionMapping[extension] ?? extension;
}
