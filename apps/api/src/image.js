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

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sharp from 'sharp';

const PASSTHROUGH = new Set(['jpeg', 'jpg', 'png']);
const MAX_EDGE = 4096;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const badUrl = (message) => Object.assign(new Error(message), { status: 400 });

function isPrivateAddress(address) {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^(?:fe8|fe9|fea|feb)/.test(normalized)) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) !== 4) return false;

  const [a, b] = normalized.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Rejects image URLs that could make the public API reach an internal service. */
export async function validateRemoteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw badUrl('That image URL is not valid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw badUrl('Image URLs must use HTTPS.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw badUrl('Private network image URLs are not allowed.');

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw badUrl('That image host could not be found.');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw badUrl('Private network image URLs are not allowed.');
  }
  return url;
}

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

/**
 * Fetches a remote image, turning transport failures into something readable.
 * Node's fetch throws a bare "fetch failed" for DNS, TLS and connection errors,
 * which tells a user nothing about what went wrong.
 */
export async function fetchImage(url, label = 'the product image') {
  let current = await validateRemoteUrl(url);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let res;
    try {
      res = await fetch(current, { redirect: 'manual' });
    } catch {
      throw new Error(`Could not reach ${label}. The site may be blocking it, or you may be offline.`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (redirects === MAX_REDIRECTS) throw new Error(`Could not download ${label} (too many redirects).`);
      current = await validateRemoteUrl(new URL(res.headers.get('location'), current).href);
      continue;
    }
    if (!res.ok) throw new Error(`Could not download ${label} (HTTP ${res.status}).`);

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new Error(`${label} is over 10MB.`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error(`${label} is over 10MB.`);
    return buffer;
  }
  throw new Error(`Could not download ${label}.`);
}

/** Builds the data URL the vision model consumes. */
export function toDataUrl(buffer, contentType = 'image/jpeg') {
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}
