/**
 * Saved looks and collections.
 *
 * Renders are stored as files on disk rather than as links, because YouCam's
 * result URLs are pre-signed and expire after two hours — a saved link would be
 * a dead image by the next day. The trade-off is that the library is only
 * readable while this server is running; the side panel says so explicitly
 * rather than showing broken thumbnails.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const IMAGES = path.join(ROOT, 'looks');
const DB = path.join(ROOT, 'db.json');

const EMPTY = { collections: [], looks: [] };

async function read() {
  try {
    return { ...EMPTY, ...JSON.parse(await fs.readFile(DB, 'utf8')) };
  } catch {
    return structuredClone(EMPTY);
  }
}

// Writes are serialised through a promise chain: a burst of saves from the panel
// would otherwise interleave read-modify-write and lose entries.
let queue = Promise.resolve();
function write(mutate) {
  const run = queue.then(async () => {
    await fs.mkdir(IMAGES, { recursive: true });
    const db = await read();
    const result = await mutate(db);
    await fs.writeFile(DB, JSON.stringify(db, null, 1));
    return result;
  });
  // The chain must keep moving even when a write fails. Advancing `queue` on the
  // settled-and-swallowed promise means one bad save can't wedge every later one.
  queue = run.catch(() => {});
  return run;
}

const id = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/* ---------------------------------------------------------------- collections */

export async function listAll() {
  const db = await read();
  return {
    collections: db.collections,
    looks: db.looks.map((l) => ({ ...l, imageUrl: `/looks/${l.id}.jpg` })),
  };
}

export function createCollection(name) {
  return write((db) => {
    const c = { id: id(), name: String(name || 'Untitled').slice(0, 60).trim(), createdAt: new Date().toISOString() };
    db.collections.push(c);
    return c;
  });
}

export function renameCollection(cid, name) {
  return write((db) => {
    const c = db.collections.find((x) => x.id === cid);
    if (c) c.name = String(name).slice(0, 60).trim();
    return c;
  });
}

/** Deleting a collection keeps its looks; they fall back to Unsorted. */
export function deleteCollection(cid) {
  return write((db) => {
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
export async function saveLook({
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
  if (!resultUrl) throw new Error('Nothing to save — no render URL.');

  const res = await fetch(resultUrl);
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? 'That render has expired — try it on again, then save.'
        : `Could not fetch the render (HTTP ${res.status}).`
    );
  }

  const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
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
    const entry = { title: String(p?.title || '').slice(0, 160), url: p?.url || '', site: p?.site || site };
    if (p?.image) {
      try {
        const r = await fetch(p.image);
        if (r.ok) {
          const thumb = await sharp(Buffer.from(await r.arrayBuffer()))
            .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 82 })
            .toBuffer();
          await fs.mkdir(IMAGES, { recursive: true });
          await fs.writeFile(path.join(IMAGES, `${lookId}-p${i}.jpg`), thumb);
          entry.thumb = `/looks/${lookId}-p${i}.jpg`;
        }
      } catch {
        /* keep the link, drop the picture */
      }
    }
    savedProducts.push(entry);
  }

  return write(async (db) => {
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
    await fs.writeFile(path.join(IMAGES, `${look.id}.jpg`), jpeg);
    db.looks.unshift(look);
    return { ...look, imageUrl: `/looks/${look.id}.jpg` };
  });
}

export function moveLook(lookId, collectionId) {
  return write((db) => {
    const l = db.looks.find((x) => x.id === lookId);
    if (l) l.collectionId = collectionId || null;
    return l;
  });
}

export function deleteLook(lookId) {
  return write(async (db) => {
    const look = db.looks.find((l) => l.id === lookId);
    db.looks = db.looks.filter((l) => l.id !== lookId);

    // Sweep the product thumbnails too, or they accumulate as orphans on disk.
    await fs.rm(path.join(IMAGES, `${lookId}.jpg`), { force: true });
    await Promise.all(
      (look?.products || []).map((_, i) => fs.rm(path.join(IMAGES, `${lookId}-p${i}.jpg`), { force: true }))
    );
    return true;
  });
}

export const IMAGES_DIR = IMAGES;
