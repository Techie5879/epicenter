/**
 * A path's basename: its last segment, on either separator. This is the one place the
 * "folder label from an absolute path" rule lives, so the vault, its tables, and the
 * persisted tab list all read the same name for the same path. Per-file path work stays
 * in Rust; this is the JS side's folder-level label only.
 */
export const basename = (path: string): string =>
	path.split(/[/\\]/).pop() ?? path;
