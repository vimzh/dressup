/**
 * Zdress backend proxy.
 *
 * The extension cannot talk to YouCam or OpenAI directly: both are
 * server-to-server APIs, a key shipped inside an extension is trivially
 * extractable, and browser CORS would block the calls regardless. This process
 * is the only place secrets exist.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

import { uploadImage, createClothTask, pollClothTask, MAX_UPLOAD_BYTES } from './youcam.js';
import { inspectGarment, inspectPerson } from './garment.js';
import { normalizeImage, toDataUrl } from './image.js';
import * as library from './library.js';
import { prepareGarment } from './prep.js';
import { splitCollage } from './collage.js';

const app = express();
const upload = multer({ limits: { fileSize: MAX_UPLOAD_BYTES } });

// The extension calls from the myntra.com page context and from the popup
// (chrome-extension://), so origins vary. This server is local-only.
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    youcamKey: Boolean(process.env.YOUCAM_API_KEY),
    openaiKey: Boolean(process.env.OPENAI_API_KEY),
  });
});

/**
 * Uploads the user's photo once and returns a reusable file_id.
 * Every later try-on reuses this id, so browsing many products costs one upload
 * rather than one per click.
 */
app.post('/api/person', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded.' });

    log(`person upload: ${req.file.originalname} (${Math.round(req.file.size / 1024)}KB)`);

    // Phone cameras hand out HEIC and oversized images; normalise before anything
    // else looks at the bytes.
    const { buffer, contentType, changed } = await normalizeImage(req.file.buffer);
    if (changed) log(`  normalised: ${changed}`);

    // Check the photo once, here, rather than letting every later try-on come
    // out subtly wrong with no explanation.
    const check = await inspectPerson(buffer, contentType);
    log(`  photo: usable=${check.usable} framing=${check.framing} issues=[${check.issues.join(',')}]`);

    if (!check.usable) {
      return res.status(422).json({
        error: check.advice || 'That photo won’t work for try-on.',
        code: 'BAD_PHOTO',
        check,
      });
    }

    const fileId = await uploadImage(buffer, {
      fileName: contentType === 'image/png' ? 'person.png' : 'person.jpg',
      contentType,
      kind: 'cloth',
    });

    log(`person file_id: ${fileId}`);
    // `advice` is a non-blocking nudge — the photo works, it could just be better.
    res.json({ personFileId: fileId, check });
  } catch (err) {
    log('person upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Runs a single try-on: screen the garment, upload it, start the task, poll. */
app.post('/api/tryon', async (req, res) => {
  const { personFileId, garmentImageUrl, productTitle = '', mode = 'single' } = req.body || {};
  if (!personFileId) return res.status(400).json({ error: 'Upload your photo first.', code: 'NO_PERSON' });
  if (!garmentImageUrl) return res.status(400).json({ error: 'No garment image supplied.', code: 'NO_GARMENT' });

  try {
    log(`tryon: ${productTitle || garmentImageUrl.slice(0, 90)}`);

    // 1. Download once, then normalise. Retailer CDNs don't always serve what
    //    their URLs promise — AJIO returns AVIF from a .jpg path, which neither
    //    OpenAI nor YouCam accepts.
    const imgRes = await fetch(garmentImageUrl);
    if (!imgRes.ok) throw new Error(`Could not download the product image (HTTP ${imgRes.status}).`);
    const raw = Buffer.from(await imgRes.arrayBuffer());

    const { buffer, contentType, changed } = await normalizeImage(raw);
    if (changed) log(`  normalised: ${changed}`);

    // 2. Screen before spending a YouCam unit. The listing title resolves cases
    //    the photo alone can't — a tracksuit set reads as just a jacket otherwise.
    const garment = await inspectGarment(toDataUrl(buffer, contentType), productTitle);
    log(`  screening: apparel=${garment.isApparel} category=${garment.category} (${garment.description})`);

    /*
     * A Pinterest pin is often a moodboard rather than a worn look: a cap, a tee,
     * a tote, shorts and trainers laid out separately. Screening correctly calls
     * that a collage and refuses it — but it is still an outfit, just
     * pre-separated. Cut out the wearable pieces and chain them.
     */
    if (!garment.isApparel && mode === 'whole_look') {
      const pieces = await splitCollage(buffer);
      if (pieces.length) {
        pieces.sort((a, b) => inLayerOrder(a.category, b.category));
        log(`  moodboard: ${pieces.map((p) => p.category).join(' -> ')}`);

        const resultUrl = await renderChain(personFileId, pieces);
        return res.json({
          resultUrl,
          garment: {
            ...garment,
            isApparel: true,
            category: pieces.map((p) => p.category).join('+'),
            description: pieces.map((p) => p.title).join(', '),
          },
          pieces: pieces.map((p) => ({ title: p.title, category: p.category })),
        });
      }
    }

    if (!garment.isApparel) {
      return res.status(422).json({ error: garment.reason, code: 'NOT_APPAREL', garment });
    }

    /*
     * 3. Optional garment clean-up. OFF by default: measured across ten input
     *    variants on two garments, rebuilding the garment with an image model
     *    never beat the untouched original and sometimes destroyed it — a
     *    tracksuit came back as a jacket alone, and YouCam then invented
     *    leggings for the missing half. See tools/stress-inputs.js.
     */
    let garmentBuffer = buffer;
    if (process.env.GARMENT_PREP === '1') {
      const prep = await prepareGarment(buffer, garment);
      log(`  prep: ${prep.prepped ? 'applied' : 'skipped'} — ${prep.why}`);
      garmentBuffer = prep.buffer;
    }

    /*
     * 4. Whole-look sources (a Pinterest pin) are an outfit on a person, not a
     *    product with one slot. Applying everything YouCam supports is the point
     *    of the click there, so the classifier's slot is overridden — but only
     *    after screening has confirmed it is apparel at all.
     */
    const wholeLook = mode === 'whole_look';
    const category = wholeLook ? 'full_body' : garment.category || 'auto';
    const changeShoes = wholeLook || garment.category === 'shoes';
    if (wholeLook) log(`  whole-look: category ${garment.category} -> full_body, change_shoes on`);

    // 5. Hand the bytes to YouCam.
    const garmentFileId = await uploadImage(garmentBuffer, {
      fileName: contentType === 'image/png' ? 'garment.png' : 'garment.jpg',
      contentType,
      kind: 'cloth',
    });
    log(`  garment file_id: ${garmentFileId}`);

    // 6. Start the task and wait it out.
    const taskId = await createClothTask({
      personFileId,
      garmentFileId,
      garmentCategory: category,
      changeShoes,
    });
    log(`  task_id: ${taskId}`);

    const resultUrl = await pollClothTask(taskId, {
      onProgress: (s) => log(`  status: ${s}`),
    });
    log(`  done: ${resultUrl.slice(0, 90)}`);

    res.json({ resultUrl, garment });
  } catch (err) {
    log('tryon failed:', err.message);
    res.status(500).json({ error: err.message, code: 'TRYON_FAILED' });
  }
});

/*
 * Screening only — no render, so no YouCam units.
 *
 * The panel needs a garment's slot the moment it is ticked, so it can say "you
 * already picked jeans" up front instead of letting the user wait through a
 * render only to be told one piece was dropped. Results are cached by image URL
 * because the same item is often ticked, unticked and re-ticked.
 */
const classifyCache = new Map();

app.post('/api/classify', async (req, res) => {
  const { garmentImageUrl, productTitle = '' } = req.body || {};
  if (!garmentImageUrl) return res.status(400).json({ error: 'No garment image supplied.' });

  if (classifyCache.has(garmentImageUrl)) return res.json(classifyCache.get(garmentImageUrl));

  try {
    const r = await fetch(garmentImageUrl);
    if (!r.ok) throw new Error(`Could not download the product image (HTTP ${r.status}).`);
    const { buffer, contentType } = await normalizeImage(Buffer.from(await r.arrayBuffer()));

    const garment = await inspectGarment(toDataUrl(buffer, contentType), productTitle);
    const out = {
      isApparel: garment.isApparel,
      category: garment.category,
      description: garment.description,
      reason: garment.reason,
    };

    // Bounded: a long browsing session shouldn't grow this without limit.
    if (classifyCache.size > 500) classifyCache.clear();
    classifyCache.set(garmentImageUrl, out);

    log(`classify: ${String(productTitle).slice(0, 40)} -> ${out.category}`);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
 * Multi-garment outfits.
 *
 * YouCam's cloth task accepts exactly one `ref_file_id`, so an outfit can't be
 * rendered in a single call. Instead each garment is applied in turn, with the
 * previous render becoming the person image for the next step. Verified to hold
 * up across retailers — Myntra trousers plus a Flipkart tee compose correctly
 * with the face, pose and background preserved throughout.
 *
 * Order matters. Lower body goes on before upper body so a longer top layers
 * over the waistband rather than being cut by it, and shoes go last.
 */
const LAYER_ORDER = { full_body: 0, lower_body: 1, upper_body: 2, shoes: 3 };

/**
 * Applies garments one after another, each render becoming the person image for
 * the next. Shared by the tick-built outfit and by a moodboard pin split into
 * its pieces — both are "several garments, one body".
 *
 * @param {string} personFileId
 * @param {Array<{buffer: Buffer, contentType: string, category: string, title?: string}>} pieces
 *   already in the order they should be applied
 */
async function renderChain(personFileId, pieces) {
  let srcFileId = personFileId;
  let resultUrl = null;

  for (const [i, piece] of pieces.entries()) {
    const garmentFileId = await uploadImage(piece.buffer, {
      fileName: piece.contentType === 'image/png' ? 'garment.png' : 'garment.jpg',
      contentType: piece.contentType,
      kind: 'cloth',
    });

    const taskId = await createClothTask({
      personFileId: srcFileId,
      garmentFileId,
      garmentCategory: piece.category,
      changeShoes: piece.category === 'shoes',
    });
    resultUrl = await pollClothTask(taskId);
    log(`  step ${i + 1}/${pieces.length} (${piece.category}) done`);

    // Re-upload the render as the person image for the following layer.
    if (i < pieces.length - 1) {
      const stepRes = await fetch(resultUrl);
      const { buffer, contentType } = await normalizeImage(Buffer.from(await stepRes.arrayBuffer()));
      srcFileId = await uploadImage(buffer, { fileName: 'step.jpg', contentType, kind: 'cloth' });
    }
  }
  return resultUrl;
}

const inLayerOrder = (a, b) => (LAYER_ORDER[a] ?? 9) - (LAYER_ORDER[b] ?? 9);

app.post('/api/outfit', async (req, res) => {
  const { personFileId, items } = req.body || {};
  if (!personFileId) return res.status(400).json({ error: 'Upload your photo first.', code: 'NO_PERSON' });
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Pick at least one item first.', code: 'NO_ITEMS' });
  }
  if (items.length > 4) {
    return res.status(400).json({ error: 'Try up to 4 pieces at a time.', code: 'TOO_MANY' });
  }

  try {
    log(`outfit: ${items.length} item(s)`);

    // 1. Download, normalise and screen everything first, so a bad pick is
    //    reported before any render time is spent.
    const screened = [];
    for (const item of items) {
      const r = await fetch(item.garmentImageUrl);
      if (!r.ok) throw new Error(`Could not download "${item.productTitle || 'an item'}".`);
      const { buffer, contentType, changed } = await normalizeImage(Buffer.from(await r.arrayBuffer()));
      if (changed) log(`  normalised: ${changed}`);

      const garment = await inspectGarment(toDataUrl(buffer, contentType), item.productTitle);
      log(`  ${item.productTitle?.slice(0, 40)}: ${garment.category} (apparel=${garment.isApparel})`);
      screened.push({ ...item, garment, buffer, contentType });
    }

    const rejected = screened.filter((s) => !s.garment.isApparel);
    const usable = screened.filter((s) => s.garment.isApparel);
    if (!usable.length) {
      return res.status(422).json({
        error: rejected[0]?.garment.reason || 'None of those can be tried on.',
        code: 'NOT_APPAREL',
        rejected: rejected.map((r) => ({ title: r.productTitle, reason: r.garment.reason })),
      });
    }

    // 2. Resolve conflicts. You can't wear two shirts, and a full-body piece
    //    (dress, tracksuit) already covers both halves. Keep the most recent
    //    pick per slot and tell the user what was dropped.
    const bySlot = new Map();
    const skipped = [];
    for (const s of usable) {
      const slot = s.garment.category;
      if (bySlot.has(slot)) skipped.push({ title: bySlot.get(slot).productTitle, why: `replaced by another ${slot.replace('_', ' ')} piece` });
      bySlot.set(slot, s);
    }
    if (bySlot.has('full_body')) {
      for (const slot of ['upper_body', 'lower_body']) {
        if (bySlot.has(slot)) {
          skipped.push({ title: bySlot.get(slot).productTitle, why: 'the full-body piece already covers this' });
          bySlot.delete(slot);
        }
      }
    }

    const plan = [...bySlot.values()].sort(
      (a, b) => (LAYER_ORDER[a.garment.category] ?? 9) - (LAYER_ORDER[b.garment.category] ?? 9)
    );
    log(`  plan: ${plan.map((p) => p.garment.category).join(' -> ')}${skipped.length ? ` (skipped ${skipped.length})` : ''}`);

    // 3. Apply each piece in turn, feeding each render into the next step.
    const resultUrl = await renderChain(
      personFileId,
      plan.map((p) => ({ buffer: p.buffer, contentType: p.contentType, category: p.garment.category }))
    );

    res.json({
      resultUrl,
      applied: plan.map((p) => ({ title: p.productTitle, category: p.garment.category, description: p.garment.description })),
      skipped,
      rejected: rejected.map((r) => ({ title: r.productTitle, reason: r.garment.reason })),
    });
  } catch (err) {
    log('outfit failed:', err.message);
    res.status(500).json({ error: err.message, code: 'TRYON_FAILED' });
  }
});

/* ------------------------------------------------------- saved looks library */

app.use('/looks', express.static(library.IMAGES_DIR, { maxAge: '1h' }));

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    log('library:', err.message);
    res.status(500).json({ error: err.message });
  }
};

app.get('/api/library', wrap(() => library.listAll()));
app.post('/api/collections', wrap((req) => library.createCollection(req.body?.name)));
app.patch('/api/collections/:id', wrap((req) => library.renameCollection(req.params.id, req.body?.name)));
app.delete('/api/collections/:id', wrap((req) => library.deleteCollection(req.params.id)));

app.post('/api/looks', wrap(async (req) => {
  const look = await library.saveLook(req.body || {});
  log(`saved look: ${look.title.slice(0, 50)}`);
  return look;
}));
app.patch('/api/looks/:id', wrap((req) => library.moveLook(req.params.id, req.body?.collectionId)));
app.delete('/api/looks/:id', wrap((req) => library.deleteLook(req.params.id)));

/*
 * Without this, an oversized upload is handled by Express's default handler,
 * which replies with an HTML error page — the panel then fails parsing it as
 * JSON and reports something unrelated.
 */
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That photo is over 10MB. Try a smaller one.', code: 'TOO_LARGE' });
  }
  log('unhandled:', err?.message || err);
  res.status(500).json({ error: err?.message || 'Something went wrong.', code: 'SERVER_ERROR' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  log(`Zdress server on http://localhost:${port}`);
  if (!process.env.YOUCAM_API_KEY) log('WARNING: YOUCAM_API_KEY is not set');
  if (!process.env.OPENAI_API_KEY) log('WARNING: OPENAI_API_KEY is not set');
});
