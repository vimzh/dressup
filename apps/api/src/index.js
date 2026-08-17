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
import { normalizeImage, toDataUrl, fetchImage } from './image.js';
import * as library from './library.js';
import { prepareGarment } from './prep.js';
import { splitCollage } from './collage.js';
import { dedupe, gateStats } from './limiter.js';
import * as stylist from './stylist.js';

const app = express();
// Vercel Functions reject request bodies above 4.5 MB before Express sees them.
// The extension resizes photos before upload, and this lower limit keeps the
// server error aligned with the platform boundary.
const personUploadLimit = process.env.VERCEL ? 4 * 1024 * 1024 : MAX_UPLOAD_BYTES;
const upload = multer({ limits: { fileSize: personUploadLimit } });

/*
 * CORS is scoped to the extension, not opened to the web.
 *
 * "Local-only" is not the same as private: every page the user visits can reach
 * http://localhost:3000, and a blanket `cors()` handed all of them a readable
 * GET /api/library and a working DELETE /api/looks/:id. Nothing on the web has
 * any business here — every call comes from the service worker or the side
 * panel, both chrome-extension:// origins, and extension fetches made under
 * host_permissions may carry no Origin header at all, so a missing one is
 * allowed too. Denying an origin only withholds the CORS headers, which is
 * exactly what stops a page reading the response or preflighting a DELETE.
 */
const allowedOrigin = (origin) =>
  !origin || origin.startsWith('chrome-extension://') || /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);

app.use(cors({ origin: (origin, cb) => cb(null, allowedOrigin(origin)) }));
app.use(express.json({ limit: '1mb' }));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    youcamKey: Boolean(process.env.YOUCAM_API_KEY),
    openaiKey: Boolean(process.env.OPENAI_API_KEY),
    openai: gateStats(),
  });
});

app.get('/', (_req, res) => {
  res.json({ name: 'Zdress API', ok: true });
});

/** A random extension-local id keeps each tester's saved library separate. */
function clientId(req) {
  const value = String(req.get('x-zdress-client-id') || '');
  if (!/^[a-f0-9-]{20,64}$/i.test(value)) {
    throw new library.BadRequest('The extension needs a valid client id. Reinstall Zdress and try again.');
  }
  return value;
}

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
    const raw = await fetchImage(garmentImageUrl);
    const { buffer, contentType, changed } = await normalizeImage(raw);
    if (changed) log(`  normalised: ${changed}`);

    // 2. Screen before spending a YouCam unit. The listing title resolves cases
    //    the photo alone can't — a tracksuit set reads as just a jacket otherwise.
    const garment = await inspectGarment(toDataUrl(buffer, contentType), productTitle);
    log(
      `  screening: apparel=${garment.isApparel} category=${garment.category}` +
        `${garment.separateItems ? ' board' : ''} (${garment.description})`
    );

    /*
     * A Pinterest pin is often a moodboard rather than a worn look: a cap, a tee,
     * a tote, shorts and trainers laid out separately. Screening usually calls
     * that a collage and refuses it — but it is still an outfit, just
     * pre-separated. Cut out the wearable pieces and chain them.
     *
     * `separateItems` is what makes this reliable. Screening used to be the only
     * gate, and it reads a board of a shirt, jeans and trainers as a "co-ord set"
     * often enough to matter — full_body at 0.58 confidence on a tested pin. That
     * sent the entire board to YouCam as one garment, which is where invented
     * clothing comes from: handed a flat-lay with the jeans in the middle third,
     * it has nothing to say how long the legs are, and short ones are a perfectly
     * plausible guess. Board-shaped means split, whatever the category says.
     */
    if (mode === 'whole_look' && (!garment.isApparel || garment.separateItems)) {
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
     * 4. Whole-look sources (a Pinterest pin) are a look rather than a product
     *    with one slot, so as much of the outfit as possible is applied.
     *
     *    "As much as possible" is the important part: forcing full_body on a pin
     *    that is cropped at the waist gives YouCam no lower-body reference, and
     *    it fills the gap by inventing one — a waist-up jacket shot came back
     *    with cropped leggings that were nowhere in the source. So the upgrade
     *    only happens when screening confirms both halves are actually visible,
     *    and shoes are only swapped when the source actually shows footwear.
     */
    const wholeLook = mode === 'whole_look';
    const covers = garment.covers || [];
    const showsFullLook = covers.includes('upper_body') && covers.includes('lower_body');

    const category = wholeLook && showsFullLook ? 'full_body' : garment.category || 'auto';
    const changeShoes = wholeLook ? covers.includes('shoes') : garment.category === 'shoes';

    if (wholeLook) {
      log(
        `  whole-look: covers [${covers.join(',')}] -> ${category}` +
          `${changeShoes ? ' +shoes' : ''}${showsFullLook ? '' : ' (partial look, not upgraded)'}`
      );
    }

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
    res.status(err?.status || 500).json({ error: err.message, code: 'TRYON_FAILED' });
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
    /*
     * Share work that is already running. A finished-results cache does nothing
     * during the two seconds a call is in flight — which is exactly when a user
     * double-taps a tick, or a second tab asks about the same product.
     */
    const out = await dedupe(`classify:${garmentImageUrl}`, async () => {
      const raw = await fetchImage(garmentImageUrl);
      const { buffer, contentType } = await normalizeImage(raw);

      const garment = await inspectGarment(toDataUrl(buffer, contentType), productTitle);
      return {
        isApparel: garment.isApparel,
        category: garment.category,
        description: garment.description,
        reason: garment.reason,
      };
    });

    // Bounded: a long browsing session shouldn't grow this without limit.
    if (classifyCache.size > 500) classifyCache.clear();
    classifyCache.set(garmentImageUrl, out);

    log(`classify: ${String(productTitle).slice(0, 40)} -> ${out.category}`);
    res.json(out);
  } catch (err) {
    res.status(err?.status || 500).json({ error: err.message });
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
      // Without this an error page is passed on as if it were the render, and
      // the failure surfaces several steps later as "could not be read as an image".
      const stepRaw = await fetchImage(resultUrl, `step ${i + 1} of the render`);
      const { buffer, contentType } = await normalizeImage(stepRaw);
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
      const raw = await fetchImage(item.garmentImageUrl, `"${item.productTitle || 'an item'}"`);
      const { buffer, contentType, changed } = await normalizeImage(raw);
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
    for (const [i, s] of usable.entries()) {
      /*
       * A piece screening called apparel without naming a slot is not a slot
       * clash — it is an unknown. Keying those by index keeps them all in the
       * plan (YouCam detects the category itself from 'auto') rather than
       * silently collapsing a top and a pair of jeans into one another, and
       * keeps `slot.replace` off a null.
       */
      const slot = s.garment.category || `unknown:${i}`;
      if (bySlot.has(slot)) {
        skipped.push({
          title: bySlot.get(slot).productTitle,
          why: `replaced by another ${slot.replace('_', ' ')} piece`,
        });
      }
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
    //    `|| 'auto'` matches /api/tryon: screening can call something apparel and
    //    still decline to pick a slot, and passing that null through fails the
    //    category guard in youcam.js — sinking the whole outfit over one piece
    //    that YouCam would happily have detected itself.
    const resultUrl = await renderChain(
      personFileId,
      plan.map((p) => ({
        buffer: p.buffer,
        contentType: p.contentType,
        category: p.garment.category || 'auto',
      }))
    );

    res.json({
      resultUrl,
      applied: plan.map((p) => ({ title: p.productTitle, category: p.garment.category, description: p.garment.description })),
      skipped,
      rejected: rejected.map((r) => ({ title: r.productTitle, reason: r.garment.reason })),
    });
  } catch (err) {
    log('outfit failed:', err.message);
    res.status(err?.status || 500).json({ error: err.message, code: 'TRYON_FAILED' });
  }
});

/* --------------------------------------------------------- expert opinion */

/*
 * "Is this actually any good on me?" is the question a try-on raises and does
 * not answer. This does: one call over the render itself for the opening read,
 * then a short back-and-forth for whatever the user asks next.
 *
 * The subject is always the render, never the product photo — advice about a
 * garment on a catalogue model is advice about the model.
 *
 * Opinions are cached by render, because opening a saved look twice should not
 * cost twice, and because a stylist who changes their mind between two views of
 * the same picture reads as broken rather than thoughtful.
 */
const opinionCache = new Map();

/** Resolves whatever the caller pointed at into image bytes plus its context. */
async function adviceSubject({ lookId, resultUrl, context = {}, client }) {
  if (lookId) {
    const { look, image } = await library.getLookImage(client, lookId);
    return {
      key: `look:${lookId}`,
      dataUrl: toDataUrl(image, 'image/jpeg'),
      context: {
        title: look.title,
        pieces: look.pieces?.length ? look.pieces : (look.products || []).map((p) => p.title).filter(Boolean),
        category: look.category,
        site: look.site,
      },
    };
  }

  if (!resultUrl) throw new library.BadRequest('Nothing to look at — no render was supplied.');

  const raw = await fetchImage(resultUrl, 'that render').catch((err) => {
    // Pre-signed YouCam URLs die after two hours, and "HTTP 403" sends the user
    // looking for a bug that isn't there.
    if (/HTTP 403/.test(err.message)) throw new library.BadRequest('That render has expired — try it on again, then ask.');
    throw err;
  });
  const { buffer, contentType } = await normalizeImage(raw);
  return { key: `render:${resultUrl}`, dataUrl: toDataUrl(buffer, contentType), context };
}

app.post('/api/advice', async (req, res) => {
  const { lookId, resultUrl, context, messages = [], opinion = null } = req.body || {};

  try {
    const subject = await adviceSubject({ lookId, resultUrl, context, client: lookId ? clientId(req) : null });

    // A follow-up question. Not cached — the whole point is that it's new.
    if (Array.isArray(messages) && messages.length) {
      const question = messages[messages.length - 1]?.content || '';
      log(`advice: "${String(question).slice(0, 60)}"`);
      return res.json({ answer: await stylist.reply(subject.dataUrl, subject.context, opinion, messages) });
    }

    if (opinionCache.has(subject.key)) return res.json({ opinion: opinionCache.get(subject.key) });

    // Two clicks on the same button, or the panel and the page asking together,
    // share one call rather than racing to fill the cache twice.
    const out = await dedupe(`advice:${subject.key}`, () => stylist.opinion(subject.dataUrl, subject.context));

    if (opinionCache.size > 200) opinionCache.clear();
    opinionCache.set(subject.key, out);

    log(`advice: ${String(subject.context.title || '').slice(0, 40)} -> "${out.headline}"`);
    res.json({ opinion: out });
  } catch (err) {
    log('advice failed:', err.message);
    res.status(err?.status || 500).json({ error: err.message, code: 'ADVICE_FAILED' });
  }
});

/* ------------------------------------------------------- saved looks library */

app.get('/looks/:client/:file', async (req, res) => {
  try {
    const image = await library.getImage(req.params.client, req.params.file);
    res.set('Cache-Control', 'private, max-age=3600').type('jpeg').send(image);
  } catch (err) {
    res.status(err?.status || 404).json({ error: err.message });
  }
});

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    // A caller mistake ("name that collection") is a 400; only real faults are 500s.
    const status = err?.status || 500;
    log('library:', err.message);
    res.status(status).json({ error: err.message });
  }
};

app.get('/api/library', wrap((req) => library.listAll(clientId(req))));
app.post('/api/collections', wrap((req) => library.createCollection(clientId(req), req.body?.name)));
app.patch('/api/collections/:id', wrap((req) => library.renameCollection(clientId(req), req.params.id, req.body?.name)));
app.delete('/api/collections/:id', wrap((req) => library.deleteCollection(clientId(req), req.params.id)));

app.post('/api/looks', wrap(async (req) => {
  const look = await library.saveLook(clientId(req), req.body || {});
  log(`saved look: ${look.title.slice(0, 50)}`);
  return look;
}));
app.patch('/api/looks/:id', wrap((req) => library.moveLook(clientId(req), req.params.id, req.body?.collectionId)));
app.delete('/api/looks/:id', wrap((req) => library.deleteLook(clientId(req), req.params.id)));

/*
 * Everything the extension calls parses the reply as JSON, so every failure has
 * to be JSON too. Express's defaults are HTML, which the panel then fails to
 * parse and reports as something unrelated to the real problem.
 */
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'No such endpoint.', code: 'NOT_FOUND' });
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    const limit = Math.floor(personUploadLimit / 1024 / 1024);
    return res.status(413).json({ error: `That photo is over ${limit}MB. Try a smaller one.`, code: 'TOO_LARGE' });
  }
  // A malformed body is the caller's mistake, not a server fault, and the raw
  // parser message ("Unexpected token 'n'") means nothing to anyone.
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'That request body was not valid JSON.', code: 'BAD_JSON' });
  }
  log('error:', err?.message || err);
  res.status(500).json({ error: err?.message || 'Something went wrong.', code: 'SERVER_ERROR' });
});

if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    log(`Zdress server on http://localhost:${port}`);
    if (!process.env.YOUCAM_API_KEY) log('WARNING: YOUCAM_API_KEY is not set');
    if (!process.env.OPENAI_API_KEY) log('WARNING: OPENAI_API_KEY is not set');
  });
}

export default app;
