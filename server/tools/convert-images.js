#!/usr/bin/env node
/**
 * Standalone image converter.
 *
 * The extension already normalises every image in-flight (server/src/image.js),
 * so this is not needed for the app to work. It exists for the case where you
 * have files or URLs in hand — an AJIO product image saved locally, a folder of
 * AVIF/HEIC/WebP downloads — and want ordinary JPEGs to inspect or re-upload.
 *
 * Usage:
 *   node tools/convert-images.js <file|dir|url> [...] [--out DIR] [--format jpeg|png] [--max 4096]
 *
 * Examples:
 *   node tools/convert-images.js ./downloads --out ./converted
 *   node tools/convert-images.js "https://assets-jiocdn.ajio.com/....jpg"
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const FORMATS = new Set(['jpeg', 'png']);
const IMAGE_EXT = /\.(avif|heic|heif|webp|jpe?g|png|tiff?|gif|bmp)$/i;

function parseArgs(argv) {
  const inputs = [];
  const opts = { out: null, format: 'jpeg', max: 4096, quality: 92 };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--format') opts.format = String(argv[++i]).toLowerCase();
    else if (a === '--max') opts.max = Number(argv[++i]);
    else if (a === '--quality') opts.quality = Number(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else inputs.push(a);
  }
  return { inputs, opts };
}

const isUrl = (s) => /^https?:\/\//i.test(s);

/** Expands directories one level into their image files. */
async function expand(input) {
  if (isUrl(input)) return [input];
  const stat = await fs.stat(input).catch(() => null);
  if (!stat) throw new Error(`Not found: ${input}`);
  if (!stat.isDirectory()) return [input];

  const entries = await fs.readdir(input);
  return entries.filter((f) => IMAGE_EXT.test(f)).map((f) => path.join(input, f));
}

async function read(source) {
  if (!isUrl(source)) return fs.readFile(source);

  const res = await fetch(source);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Derives an output filename, since URLs and directories both need one. */
function outputName(source, format, outDir) {
  const raw = isUrl(source) ? path.basename(new URL(source).pathname) || 'image' : path.basename(source);
  const base = raw.replace(/\.[^.]+$/, '') || 'image';
  const dir = outDir ?? (isUrl(source) ? process.cwd() : path.dirname(source));
  return path.join(dir, `${base}.${format === 'jpeg' ? 'jpg' : 'png'}`);
}

async function main() {
  const { inputs, opts } = parseArgs(process.argv.slice(2));

  if (opts.help || !inputs.length) {
    console.log(`Convert images (AVIF/HEIC/WebP/…) to JPEG or PNG.

  node tools/convert-images.js <file|dir|url> [...] [options]

  --out DIR         write here (default: alongside the input, or cwd for URLs)
  --format jpeg|png output format (default: jpeg)
  --max N           longest edge, downscaled if larger (default: 4096)
  --quality N       JPEG quality (default: 92)

Note: the Zdress server converts images automatically at request time.
This tool is only for converting files you already have.`);
    process.exit(inputs.length ? 0 : 1);
  }

  if (!FORMATS.has(opts.format)) {
    console.error(`Unsupported --format "${opts.format}". Use jpeg or png.`);
    process.exit(1);
  }
  if (opts.out) await fs.mkdir(opts.out, { recursive: true });

  const sources = (await Promise.all(inputs.map(expand))).flat();
  if (!sources.length) {
    console.error('No images found in the given paths.');
    process.exit(1);
  }

  let ok = 0;
  let failed = 0;

  for (const source of sources) {
    const label = isUrl(source) ? source.slice(0, 68) : path.basename(source);
    try {
      const input = await read(source);
      const meta = await sharp(input).metadata();

      let pipeline = sharp(input);
      const oversized = Math.max(meta.width || 0, meta.height || 0) > opts.max;
      if (oversized) pipeline = pipeline.resize(opts.max, opts.max, { fit: 'inside', withoutEnlargement: true });

      // Flatten onto white: transparency becomes black when encoding to JPEG.
      if (opts.format === 'jpeg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: opts.quality });
      else pipeline = pipeline.png();

      const output = await pipeline.toBuffer();
      const dest = outputName(source, opts.format, opts.out);
      await fs.writeFile(dest, output);

      const resized = oversized ? ` resized→${opts.max}` : '';
      console.log(`✓ ${label}  ${meta.format} ${meta.width}x${meta.height} → ${opts.format}${resized}  ${path.basename(dest)}`);
      ok++;
    } catch (err) {
      console.error(`✗ ${label}  ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${ok} converted, ${failed} failed.`);
  process.exit(failed && !ok ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
