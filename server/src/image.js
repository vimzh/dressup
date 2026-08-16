/**
 * Image normalisation.
 *
 * Retailer CDNs do not serve what their URLs promise. AJIO's product images end
 * in `.jpg` but are served as `image/avif` — a format both YouCam and OpenAI
 * reject outright. Rather than special-case one retailer, every garment image is
 * put through here before it goes anywhere.
 *
 * This also enforces YouCam's documented input limits (jpg/png, under 10MB, long
 * side at most 4096px) at the point where they can actually be fixed, instead of
 * failing the request later.
 */

import sharp from 'sharp';

const PASSTHROUGH = new Set(['jpeg', 'jpg', 'png']);
const MAX_EDGE = 4096;
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * @param {Buffer} buffer raw downloaded image
 * @returns {Promise<{buffer: Buffer, contentType: string, changed: string|null}>}
 *   `changed` describes what was done, for logging; null when untouched.
 */
export async function normalizeImage(buffer) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new Error('That product image could not be read as an image.');
  }

  const reasons = [];
  const tooBig = Math.max(meta.width || 0, meta.height || 0) > MAX_EDGE;
  const wrongFormat = !PASSTHROUGH.has(meta.format);
  const tooHeavy = buffer.length >= MAX_BYTES;

  if (!wrongFormat && !tooBig && !tooHeavy) {
    return { buffer, contentType: meta.format === 'png' ? 'image/png' : 'image/jpeg', changed: null };
  }

  if (wrongFormat) reasons.push(`${meta.format}->jpeg`);
  if (tooBig) reasons.push(`resize ${meta.width}x${meta.height}->${MAX_EDGE}`);
  if (tooHeavy) reasons.push(`${Math.round(buffer.length / 1024 / 1024)}MB->recompress`);

  let pipeline = sharp(buffer);
  if (tooBig) pipeline = pipeline.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true });

  // Flatten onto white: transparent PNGs become black boxes once converted to
  // JPEG, and plenty of catalogue cut-outs ship with an alpha channel.
  const out = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();

  return { buffer: out, contentType: 'image/jpeg', changed: reasons.join(', ') };
}

/** Builds the data URL the vision model consumes. */
export function toDataUrl(buffer, contentType = 'image/jpeg') {
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}
