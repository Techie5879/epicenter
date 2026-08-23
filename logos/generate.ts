#!/usr/bin/env bun
import { join } from 'node:path';
/**
 * Rebuild the raster derivatives in `generated/` from the canonical SVGs in
 * `source/`. PNG is used so the outputs carry alpha and work as app icons,
 * favicons, and social previews everywhere.
 *
 * Usage:  bun run logos/generate.ts
 *
 * Requires ImageMagick (`brew install imagemagick`). The wordmark is not
 * rasterized here because its text needs the Manrope font, which is not
 * resolvable offline; see README.md for the opt-in command.
 */
import { $ } from 'bun';

const root = import.meta.dir;
const source = join(root, 'source');
const generated = join(root, 'generated');

/** Long-edge pixel size for every generated raster. */
const SIZE = 1024;

/** Pure-shape sources that rasterize with ImageMagick alone (no fonts). */
const icons = [
	'epicenter-icon',
	'epicenter-icon-square',
	'epicenter-icon-squircle',
] as const;

await $`mkdir -p ${generated}`;

for (const name of icons) {
	const src = join(source, `${name}.svg`);
	const out = join(generated, `${name}-${SIZE}.png`);
	// -background none keeps the squircle's rounded corners transparent.
	// -density 600 rasterizes the vector at high resolution before resizing.
	// -colorspace sRGB + TrueColorAlpha forces 8-bit RGBA for broad
	// compatibility (otherwise ImageMagick emits 16-bit grayscale).
	await $`magick -background none -density 600 ${src} -resize ${SIZE}x${SIZE} -colorspace sRGB -type TrueColorAlpha -depth 8 ${out}`;
	const dimensions = (
		await $`magick identify -format "%wx%h" ${out}`.text()
	).trim();
	console.log(`✓ ${name}-${SIZE}.png  (${dimensions})`);
}
