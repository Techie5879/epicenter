/**
 * File formats and limits the import surface accepts.
 *
 * Import is its own surface, not a recording trigger (see ADR-0013), so this
 * policy lives apart from the recording constants. The web drop zone uses the
 * MIME `accept` string, desktop drag-and-drop filters dropped paths by
 * extension, and `importFiles` enforces the same count, size, and type limits
 * before processing.
 */
export const IMPORT_ACCEPT_AUDIO = 'audio/*';
export const IMPORT_ACCEPT_VIDEO = 'video/*';
export const IMPORT_ACCEPT = `${IMPORT_ACCEPT_AUDIO}, ${IMPORT_ACCEPT_VIDEO}`;

export const MAX_IMPORT_FILES = 10;

const BYTES_PER_MEGABYTE = 1024 * 1024;
export const MAX_IMPORT_FILE_SIZE = 25 * BYTES_PER_MEGABYTE;

export const IMPORTABLE_MIME_PREFIXES = ['audio/', 'video/'] as const;

export const IMPORTABLE_AUDIO_EXTENSIONS = [
	'mp3',
	'wav',
	'm4a',
	'aac',
	'ogg',
	'flac',
	'wma',
	'opus',
] as const;

export const IMPORTABLE_VIDEO_EXTENSIONS = [
	'mp4',
	'avi',
	'mov',
	'wmv',
	'flv',
	'mkv',
	'webm',
	'm4v',
] as const;
