/**
 * Splitting a flat-lay pin into wearable pieces.
 *
 * Pinterest fashion comes in two shapes. One is a person wearing a look, which
 * YouCam consumes directly as `full_body`. The other — extremely common — is a
 * moodboard: a cap, a tee, a tote, shorts and trainers laid out separately on a
 * plain background. YouCam cannot take that as one garment, and screening
 * rightly rejects it as a collage.
 *
 * But a moodboard is an outfit; it is just pre-separated. So the pieces are
 * located and cut out, then run through the existing outfit chain — the same
 * path that already composes a Flipkart tee with Myntra trousers.
 *
 * Two rules keep this honest:
 *
 *   1. **Nothing is generated.** A vision model is asked only for the *location*
 *      of each garment; the cutting is done by sharp, so every output pixel came
 *      from the source. This is deliberate — rebuilding garments with an image
 *      model was measured to lose logos and whole pieces (tools/stress-inputs.js).
 *   2. **Every crop is re-screened.** A bounding box that turns out to hold a
 *      tote bag, or half a garment, is discarded rather than rendered.
 */

import OpenAI from 'openai';
import { runLimited } from './limiter.js';
import sharp from 'sharp';
import { CATEGORIES } from './garment.js';
import { toDataUrl } from './image.js';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let client;
function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      description: 'One entry per wearable garment. Empty if there are none.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'label', 'x0', 'y0', 'x1', 'y1'],
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          label: { type: 'string', description: 'Short description, e.g. "cream graphic tee".' },
          x0: { type: 'number', description: 'Left edge, 0-1 of image width.' },
          y0: { type: 'number', description: 'Top edge, 0-1 of image height.' },
          x1: { type: 'number', description: 'Right edge, 0-1 of image width.' },
          y1: { type: 'number', description: 'Bottom edge, 0-1 of image height.' },
        },
      },
    },
  },
};

const PROMPT = `This image is an outfit moodboard — several clothing items laid out separately.

For every item that can be WORN ON THE BODY, give a tight bounding box around it:
  - upper_body — t-shirts, shirts, jackets, hoodies, knitwear
  - lower_body — trousers, jeans, shorts, skirts
  - full_body  — dresses, jumpsuits, co-ord sets shown as one piece
  - shoes      — any footwear

SKIP anything that is not worn on the body: bags, totes, caps, hats, jewellery,
sunglasses, watches, belts, perfume, and any text or logos.

ONE ENTRY PER GARMENT, NOT PER OBJECT. A pair of shoes is ONE item: draw a single box around
both shoes together. A shirt worn over a tee, or a jacket laid on top of a top, is one box.

Coordinates are fractions of the image, 0 to 1, with (0,0) at the top-left.

The box must contain the WHOLE garment, every edge of it:
  - Trousers and jeans: the box must reach the bottom hem of BOTH legs. Wide-leg and baggy
    denim is long and pale against a pale backdrop, and a box that stops short turns
    full-length jeans into shorts in the final render. This is the most damaging mistake
    you can make here — when unsure how far the legs go, go lower.
  - Tops: include collar, both sleeves and the full hem.
  - Include a little margin past the garment on every side.

Boards often overlap — a shirt laid across the waist of the jeans, a hem resting on a shoe.
That is normal. Never shrink a box to avoid a neighbour: a box that clips its own garment is
far worse than one that catches part of another.

Return an empty list if nothing wearable is laid out.`;

/**
 * Locates the wearable garments in a flat-lay.
 * @param {Buffer} buffer the normalised image
 */
async function locateItems(buffer) {
  const res = await runLimited(() => getClient().chat.completions.create({
    model: MODEL,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Locate the wearable items.' },
          // Full detail here: the model is being asked for coordinates, and a
          // low-detail image makes those noticeably worse.
          { type: 'image_url', image_url: { url: toDataUrl(buffer) } },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'items', strict: true, schema: SCHEMA } },
  }));
  // Same guard as the other screening calls: a refused or empty completion has
  // no content, and reaching into it blindly throws a TypeError instead of a
  // message anyone can act on.
  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error('Moodboard analysis returned an empty response.');
  return JSON.parse(raw).items || [];
}

/*
 * One box per garment, whatever the model returned.
 *
 * A pair of shoes comes back as two boxes about as often as one, which cost a
 * whole extra render step and sent each foot in separately — half a pair as the
 * reference for a pair of shoes. Two boxes over the same garment (a shirt and
 * the tee under it) have the same problem.
 *
 * So same-category boxes that touch are unioned, and only the largest survivor
 * per category is kept: YouCam wears one garment per slot regardless, exactly as
 * the tick-built outfit route already decides.
 */
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

function union(a, b) {
  return {
    ...a,
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** A pair sits side by side with a gap between the shoes; treat it as one item. */
const isPair = (a, b) =>
  a.category === 'shoes' &&
  Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.3 * Math.min(a.y1 - a.y0, b.y1 - b.y0);

function mergeItems(items) {
  const merged = [];

  for (const item of items) {
    const hit = merged.find(
      (m) => m.category === item.category && (overlaps(m, item) || isPair(m, item))
    );
    if (hit) Object.assign(hit, union(hit, item));
    else merged.push({ ...item });
  }

  // One per slot, largest wins — a stray box over a fold of the same garment
  // shouldn't beat the box over the whole thing.
  const bySlot = new Map();
  for (const m of merged) {
    const held = bySlot.get(m.category);
    if (!held || area(m) > area(held)) bySlot.set(m.category, m);
  }

  // A full-body piece already covers both halves, so the same rule as /api/outfit.
  if (bySlot.has('full_body')) {
    bySlot.delete('upper_body');
    bySlot.delete('lower_body');
  }
  return [...bySlot.values()];
}

/**
 * Cuts a box out of the image, clamped to bounds.
 *
 * Padding is asymmetric on purpose: the bottom of a lower-body box is the edge
 * that decides whether jeans read as full length, and it is the edge the model
 * most often draws short.
 */
async function cropTo(buffer, item, { width, height }) {
  const { x0, y0, x1, y1, category } = item;
  const pad = 0.035;
  const padBottom = category === 'lower_body' || category === 'full_body' ? 0.07 : pad;

  const left = Math.round(Math.max(0, x0 - pad) * width);
  const top = Math.round(Math.max(0, y0 - pad) * height);
  const right = Math.round(Math.min(1, x1 + pad) * width);
  const bottom = Math.round(Math.min(1, y1 + padBottom) * height);

  const w = right - left;
  const h = bottom - top;
  if (w < 64 || h < 64) throw new Error('crop too small');

  /*
   * Padded onto a plain background rather than squeezed: a garment must never be
   * distorted, and an extreme aspect ratio renders badly.
   *
   * It used to pad to a hard square, which is wrong for exactly the garment this
   * matters most for — a pair of wide-leg jeans is roughly 1:3, so squaring it
   * left the denim occupying a third of the frame with white either side. Now
   * the canvas only opens up as far as 3:4, so the garment stays large.
   */
  const ratio = w / h;
  const canvasW = ratio < 0.75 ? Math.round(h * 0.75) : w;
  const canvasH = ratio > 1 / 0.75 ? Math.round(w * 0.75) : h;
  const scale = Math.min(1, 1024 / Math.max(canvasW, canvasH));

  return sharp(buffer)
    .extract({ left, top, width: w, height: h })
    .resize(Math.round(canvasW * scale), Math.round(canvasH * scale), {
      fit: 'contain',
      background: '#ffffff',
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/*
 * Screening a single cut-out.
 *
 * This deliberately does NOT reuse the product-page screening. That call exists
 * to decide whether an image is one sellable garment, and it now (correctly)
 * refuses anything that looks like a board — which a crop off a board often
 * does, because boards overlap and a rectangle around the shirt catches the top
 * of the jeans. Pointing it at the crops threw away two of three real pieces.
 *
 * So the crop gets a question suited to what it is: of the garments visible
 * here, what is the main one, and is all of it in frame?
 */
const PIECE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_garment', 'category', 'description', 'cut_off', 'cut_edges'],
  properties: {
    is_garment: {
      type: 'boolean',
      description: 'True if the main subject is a wearable garment or footwear.',
    },
    category: { type: ['string', 'null'], enum: [...CATEGORIES, null] },
    description: { type: 'string', description: 'Short noun phrase: colour, then garment.' },
    cut_off: {
      type: 'boolean',
      description: 'True if part of the main garment runs off the edge of the crop.',
    },
    cut_edges: {
      type: 'array',
      items: { type: 'string', enum: ['top', 'bottom', 'left', 'right'] },
      description: 'Which edges the garment is cut off at. Empty when cut_off is false.',
    },
  },
};

const PIECE_PROMPT = `This is a crop taken from an outfit board — one garment cut out of a
layout of several. Neighbouring items often intrude at the edges, because the pieces were laid
out overlapping. Ignore them.

Report the MAIN subject: the largest, most central garment in the crop.

is_garment — false only if the main subject is not wearable: a bag, tote, cap, hat, watch,
sunglasses, belt, jewellery, or a plain background with nothing in it. Footwear is a garment
here; a pair of shoes is one item.

category — upper_body, lower_body, full_body or shoes, for the main subject only.

cut_off — is the whole main garment inside the crop? Look hard at the bottom edge of trousers
and jeans: if the legs run off the frame you must say so, because the crop is what gets worn
and a clipped pair of full-length jeans comes out as shorts. Also flag a missing sleeve, a
missing collar, or half a shoe. Say false when the garment is complete, even if a neighbour's
sleeve or hem is also in the picture.`;

async function screenPiece(crop) {
  const res = await runLimited(() => getClient().chat.completions.create({
    model: MODEL,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: PIECE_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Check this cut-out.' },
          { type: 'image_url', image_url: { url: toDataUrl(crop) } },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'piece', strict: true, schema: PIECE_SCHEMA } },
  }));

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error('Piece screening returned an empty response.');
  const parsed = JSON.parse(raw);
  return { ...parsed, cut_edges: parsed.cut_edges || [] };
}

/** Opens the named edges of a box outward, clamped to the image. */
function grow(box, edges, by = 0.09) {
  const out = { ...box };
  if (edges.includes('left')) out.x0 = Math.max(0, out.x0 - by);
  if (edges.includes('right')) out.x1 = Math.min(1, out.x1 + by);
  if (edges.includes('top')) out.y0 = Math.max(0, out.y0 - by);
  if (edges.includes('bottom')) out.y1 = Math.min(1, out.y1 + by);
  return out;
}

/**
 * Splits a moodboard into individually rendered-ready garments.
 *
 * @param {Buffer} buffer normalised source image
 * @returns {Promise<Array<{buffer: Buffer, contentType: string, category: string, title: string}>>}
 *   Ordered pieces, verified to contain what the box claimed. Empty if none survived.
 */
export async function splitCollage(buffer) {
  const meta = await sharp(buffer).metadata();
  const found = await locateItems(buffer);
  if (!found.length) return [];

  const pieces = [];
  // Merging leaves at most one item per category, so the cap is structural.
  const merged = mergeItems(found);
  log(`  board: ${found.map((f) => f.category).join(',')} -> ${merged.map((m) => m.category).join(',')}`);

  for (const item of merged) {
    try {
      /*
       * The box is a guess, so the cut-out is screened before it costs a render.
       *
       * Deliberately without the locator's label: the check is only worth having
       * if it can disagree, and screening treats a title as authoritative — pass
       * a guessed "denim shorts" in as one and it comes back confirmed as shorts
       * even when the crop plainly holds full-length jeans.
       */
      let crop = await cropTo(buffer, item, meta);
      let check = await screenPiece(crop);

      /*
       * A garment running off the edge of its own crop is the shorts bug: the
       * crop is what gets worn, so jeans clipped at the knee arrive at YouCam as
       * shorts and are rendered faithfully as shorts. One retry with the
       * offending edges opened up; if that reads worse, the first crop stands.
       */
      if (check.is_garment && check.cut_off && check.cut_edges.length) {
        const wider = await cropTo(buffer, grow(item, check.cut_edges), meta);
        const recheck = await screenPiece(wider);
        log(`  piece "${check.description}" cut off at ${check.cut_edges.join('+')} — widened`);
        if (recheck.is_garment) {
          crop = wider;
          check = recheck;
        }
      }

      if (!check.is_garment) {
        log(`  dropped a ${item.category} box — "${check.description}" isn’t wearable`);
        continue;
      }

      pieces.push({
        buffer: crop,
        contentType: 'image/jpeg',
        category: check.category || item.category,
        title: check.description || item.label,
      });
    } catch {
      /* a bad box shouldn't sink the rest of the board */
    }
  }
  return pieces;
}
