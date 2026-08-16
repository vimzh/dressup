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
import sharp from 'sharp';
import { inspectGarment, CATEGORIES } from './garment.js';
import { toDataUrl } from './image.js';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

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

Coordinates are fractions of the image, 0 to 1, with (0,0) at the top-left. Draw the box
around the whole item including sleeves and straps, with a little margin. Boxes must not
overlap another item.

Return an empty list if nothing wearable is laid out.`;

/**
 * Locates the wearable garments in a flat-lay.
 * @param {Buffer} buffer the normalised image
 */
async function locateItems(buffer) {
  const res = await getClient().chat.completions.create({
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
  });
  return JSON.parse(res.choices[0].message.content).items || [];
}

/** Cuts a normalised box out of the image, with a small margin, clamped to bounds. */
async function cropTo(buffer, { x0, y0, x1, y1 }, { width, height }, pad = 0.03) {
  const left = Math.round(Math.max(0, x0 - pad) * width);
  const top = Math.round(Math.max(0, y0 - pad) * height);
  const right = Math.round(Math.min(1, x1 + pad) * width);
  const bottom = Math.round(Math.min(1, y1 + pad) * height);

  const w = right - left;
  const h = bottom - top;
  if (w < 64 || h < 64) throw new Error('crop too small');

  return sharp(buffer)
    .extract({ left, top, width: w, height: h })
    // Flat-lays sit on near-white; padding to a square keeps the garment centred
    // and stops YouCam seeing an extreme aspect ratio.
    .resize(1024, 1024, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
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
  for (const item of found.slice(0, 4)) {
    try {
      const crop = await cropTo(buffer, item, meta);

      // The box is a guess. Confirm the cut-out really is the garment claimed
      // before it costs a render.
      const check = await inspectGarment(toDataUrl(crop), item.label);
      if (!check.isApparel) continue;

      pieces.push({
        buffer: crop,
        contentType: 'image/jpeg',
        category: check.category || item.category,
        title: item.label,
      });
    } catch {
      /* a bad box shouldn't sink the rest of the board */
    }
  }
  return pieces;
}
