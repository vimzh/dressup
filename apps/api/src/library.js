/**
 * Saved looks and collections.
 *
 * Renders are stored as files rather than as links, because YouCam's
 * result URLs are pre-signed and expire after two hours — a saved link would be
 * a dead image by the next day. Production uses private Vercel Blob storage;
 * local development uses the filesystem.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { del, get, put } from '@vercel/blob';
import { fetchImage } from './image.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const USE_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

const EMPTY = { collections: [], looks: [] };

function safeClient(client) {
  const value = String(client || '');
  if (!/^[a-f0-9-]{20,64}$/i.test(value)) throw new BadRequest('Invalid client id.');
  return value;
}

const blobPath = (client, file) => `libraries/${safeClient(client)}/${file}`;
const localPath = (client, file) => path.join(ROOT, safeClient(client), file);

async function readFile(client, file) {
  if (!USE_BLOB) return fs.readFile(localPath(client, file));
  const result = await get(blobPath(client, file), { access: 'private', useCache: false });
  if (!result?.stream) throw Object.assign(new Error('File not found.'), { code: 'ENOENT' });
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

async function writeFile(client, file, body, contentType) {
  if (!USE_BLOB) {
    const target = localPath(client, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    return fs.writeFile(target, body);
  }
  await put(blobPath(client, file), body, {
    access: 'private',
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge: 60,
  });
}

async function removeFile(client, file) {
  if (USE_BLOB) return del(blobPath(client, file));
  await fs.rm(localPath(client, file), { force: true });
}

/** A caller mistake rather than a server fault, so the route can answer 400. */
export class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequest';
    this.status = 400;
  }
}

async function read(client) {
  try {
    return { ...EMPTY, ...JSON.parse((await readFile(client, 'db.json')).toString('utf8')) };
  } catch (err) {
    if (err?.code !== 'ENOENT' && !/not found/i.test(err?.message || '')) throw err;
    return structuredClone(EMPTY);
  }
}

// Writes are serialised through a promise chain: a burst of saves from the panel
// would otherwise interleave read-modify-write and lose entries.
const queues = new Map();
function write(client, mutate) {
  const queue = queues.get(client) || Promise.resolve();
  const run = queue.then(async () => {
    const db = await read(client);
    const result = await mutate(db);
    // ponytail: per-client writes are serialized per warm instance. Move this
    // JSON document to a transactional DB if concurrent writers become normal.
    await writeFile(client, 'db.json', JSON.stringify(db, null, 1), 'application/json');
    return result;
  });
  // The chain must keep moving even when a write fails. Advancing `queue` on the
  // settled-and-swallowed promise means one bad save can't wedge every later one.
  queues.set(client, run.catch(() => {}));
  return run;
}

const id = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/* ---------------------------------------------------------------- collections */

export async function listAll(client) {
  const db = await read(client);
  return {
    collections: db.collections,
    looks: db.looks.map((l) => ({ ...l, imageUrl: `/looks/${safeClient(client)}/${l.id}.jpg` })),
  };
}

export function createCollection(client, name) {
  const clean = String(name ?? '').trim().slice(0, 60);
  // Silently filing an empty submit as "Untitled" just litters the list.
  if (!clean) throw new BadRequest('Give the collection a name.');

  return write(client, (db) => {
    const c = { id: id(), name: clean, createdAt: new Date().toISOString() };
    db.collections.push(c);
    return c;
  });
}

export function renameCollection(client, cid, name) {
  const clean = String(name ?? '').trim().slice(0, 60);
  if (!clean) throw new BadRequest('Give the collection a name.');

  return write(client, (db) => {
    const c = db.collections.find((x) => x.id === cid);
    if (!c) throw new BadRequest('That collection no longer exists.');
    c.name = clean;
    return c;
  });
}

/** Deleting a collection keeps its looks; they fall back to Unsorted. */
export function deleteCollection(client, cid) {
  return write(client, (db) => {
    db.collections = db.collections.filter((c) => c.id !== cid);
    db.looks.forEach((l) => {
      if (l.collectionId === cid) l.collectionId = null;
    });
    return true;
  });
}

/* --------------------------------------------------------------------- looks */

/**
 * Downloads a render and files it. Stored at 1080px — full render quality, since
 * disk is not the constraint here.
 */
export async function saveLook(client, {
  resultUrl,
  collectionId = null,
  title = '',
  site = '',
  category = '',
  kind = 'single',
  pieces = [],
  productUrl = '',
  products = [],
}) {
  if (!resultUrl) throw new BadRequest('Nothing to save — no render URL.');

  const render = await fetchImage(resultUrl, 'that render').catch((err) => {
    if (/HTTP 403/.test(err.message)) throw new BadRequest('That render has expired — try it on again, then save.');
    throw err;
  });
  const jpeg = await sharp(render)
    .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();

  const lookId = id();

  /*
   * The point of saving is to come back and buy the thing weeks later, by which
   * time the retailer's own CDN URL may have rotated. So each piece's product
   * photo is filed alongside the render, and the listing URL is kept with it.
   * A thumbnail that fails to download is not worth failing the save over — the
   * link still works without it.
   */
  const savedProducts = [];
  for (const [i, p] of products.slice(0, 4).entries()) {
    const entry = {
      title: String(p?.title || '').slice(0, 160),
      url: p?.url || '',
      site: p?.site || site,
      category: String(p?.category || '').slice(0, 40),
    };
    if (p?.image) {
      try {
        const thumb = await sharp(await fetchImage(p.image, 'that product image'))
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 82 })
          .toBuffer();
        await writeFile(client, `${lookId}-p${i}.jpg`, thumb, 'image/jpeg');
        entry.thumb = `/looks/${safeClient(client)}/${lookId}-p${i}.jpg`;
      } catch {
        /* keep the link, drop the picture */
      }
    }
    savedProducts.push(entry);
  }

  return write(client, async (db) => {
    const look = {
      id: lookId,
      collectionId,
      title: String(title).slice(0, 160),
      site,
      category,
      kind,
      pieces,
      productUrl,
      products: savedProducts,
      savedAt: new Date().toISOString(),
    };
    await writeFile(client, `${look.id}.jpg`, jpeg, 'image/jpeg');
    db.looks.unshift(look);
    return { ...look, imageUrl: `/looks/${safeClient(client)}/${look.id}.jpg` };
  });
}

/**
 * A saved look and its render, for anything that needs the picture back —
 * the stylist opinion asks about the render itself, not the product photo.
 * @returns {Promise<{look: object, image: Buffer}>}
 */
export async function getLookImage(client, lookId) {
  const db = await read(client);
  const look = db.looks.find((l) => l.id === lookId);
  if (!look) throw new BadRequest('That look is no longer saved.');

  try {
    return { look, image: await readFile(client, `${lookId}.jpg`) };
  } catch {
    throw new BadRequest('That look’s image is missing from disk.');
  }
}

export function moveLook(client, lookId, collectionId) {
  return write(client, (db) => {
    const l = db.looks.find((x) => x.id === lookId);
    if (l) l.collectionId = collectionId || null;
    return l;
  });
}

export function deleteLook(client, lookId) {
  return write(client, async (db) => {
    const look = db.looks.find((l) => l.id === lookId);
    db.looks = db.looks.filter((l) => l.id !== lookId);

    // Sweep the product thumbnails too, or they accumulate as orphans on disk.
    await removeFile(client, `${lookId}.jpg`);
    await Promise.all(
      (look?.products || []).map((_, i) => removeFile(client, `${lookId}-p${i}.jpg`))
    );
    return true;
  });
}

export async function getImage(client, file) {
  if (!/^[a-z0-9-]+(?:-p\d+)?\.jpg$/i.test(file)) throw new BadRequest('Invalid image path.');
  try {
    return await readFile(client, file);
  } catch {
    throw new BadRequest('That saved image is missing.');
  }
}
