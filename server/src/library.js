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
  queue = queue.then(async () => {
    await fs.mkdir(IMAGES, { recursive: true });
    const db = await read();
    const result = await mutate(db);
    await fs.writeFile(DB, JSON.stringify(db, null, 1));
    return result;
  });
  return queue;
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
export async function saveLook({ resultUrl, collectionId = null, title = '', site = '', category = '', kind = 'single', pieces = [], productUrl = '' }) {
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

  return write(async (db) => {
    const look = {
      id: id(),
      collectionId,
      title: String(title).slice(0, 160),
      site,
      category,
      kind,
      pieces,
      productUrl,
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
    db.looks = db.looks.filter((l) => l.id !== lookId);
    await fs.rm(path.join(IMAGES, `${lookId}.jpg`), { force: true });
    return true;
  });
}

export const IMAGES_DIR = IMAGES;
