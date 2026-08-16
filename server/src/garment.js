/**
 * OpenAI vision pre-flight for garment images.
 *
 * Two jobs, both of which happen before any YouCam unit is spent:
 *   1. Reject images that can't produce a meaningful try-on (accessories,
 *      close-up fabric swatches, banner ads that leak into the product grid).
 *   2. Pick the `garment_category` YouCam should use. Passing an explicit
 *      category beats YouCam's own "auto" detection when the source is a
 *      catalogue photo on a model, where the garment of interest is ambiguous
 *      (e.g. a listing for shorts where the model also wears a t-shirt).
 */

import OpenAI from 'openai';
import { runLimited } from './limiter.js';

// Screening sits on the critical path before a 10-30s render, so it is tuned for
// latency: a mini model at low reasoning effort with a low-detail image scored 5/5
// on the category/rejection cases in ~2s, versus ~7s for full gpt-5.
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

/** YouCam apparel categories we can map onto. */
export const CATEGORIES = ['upper_body', 'lower_body', 'full_body', 'shoes'];

let client;
function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set. Copy server/.env.example to server/.env and fill it in.');
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_apparel', 'category', 'confidence', 'reason', 'description', 'source_type', 'covers', 'separate_items'],
  properties: {
    is_apparel: {
      type: 'boolean',
      description: 'True only if a wearable garment is the clear subject and a virtual try-on would be meaningful.',
    },
    separate_items: {
      type: 'boolean',
      description:
        'True when the image lays out two or more distinct garments side by side as an outfit board, rather than showing one product.',
    },
    category: {
      type: ['string', 'null'],
      enum: [...CATEGORIES, null],
      description: 'The primary garment being sold. Null when is_apparel is false.',
    },
    confidence: { type: 'number', description: 'Confidence in the category, 0 to 1.' },
    reason: {
      type: 'string',
      description: 'One short user-facing sentence. When rejecting, explain plainly why try-on will not work.',
    },
    description: {
      type: 'string',
      description: 'A brief description of the garment, e.g. "navy ribbed training tank".',
    },
    covers: {
      type: 'array',
      items: { type: 'string', enum: ['upper_body', 'lower_body', 'shoes'] },
      description:
        'Which body regions this image actually shows a garment for. Only what is visible — never what a complete outfit would normally include.',
    },
    source_type: {
      type: 'string',
      enum: ['clean_product_shot', 'on_model_front', 'on_model_angled', 'cluttered_or_cropped'],
      description: 'How the garment is presented, which decides whether it needs cleaning up first.',
    },
  },
};

const PROMPT = `You screen product images from a clothing retailer before they are sent to a
virtual try-on engine.

Decide two things.

1. is_apparel — is a wearable garment the clear subject?
   Reject (false) for: bags, watches, jewellery, sunglasses, belts, caps, a fabric
   close-up with no garment shape, a promotional banner, or a collage of several
   unrelated products. Footwear IS accepted — categorise it as "shoes".

2. category — which garment is this listing actually selling? This is not always the
   most visually prominent item on the model.
   - upper_body — t-shirts, shirts, jackets, hoodies, sweaters, tops
   - lower_body — trousers, jeans, shorts, skirts, track pants, leggings
   - full_body  — ONE-PIECE garments (dresses, jumpsuits, coveralls, sarees) AND
                  multi-piece sets sold together (tracksuits, co-ord sets, suits,
                  pyjama sets). If the listing sells both a top and a bottom as one
                  product, it is full_body.
   - shoes      — any footwear

A SET IS NOT A BOARD. A co-ord set or tracksuit is ONE product: matching fabric, matching
colour, photographed as a unit. An outfit board is several unrelated garments — a shirt, some
jeans, a pair of trainers — laid out with space between them, usually on a plain backdrop, in
different colours and fabrics. Boards are extremely common and must NOT be read as full_body
sets: set separate_items=true and is_apparel=false, and say in "reason" that it shows several
separate pieces. Footwear laid out beside clothing settles it — no single product is both a
shirt and a pair of trainers.

Set separate_items=false for anything worn by a person, and for any single product, however
many photos of it are stitched together.

THE PRODUCT TITLE IS AUTHORITATIVE. When the title names the garment type, follow it
even if the photo is ambiguous or shows other clothing. A model wearing a t-shirt and
shorts on a listing titled "Track Pants" is lower_body. A listing titled "Tracksuit"
is full_body even if the jacket dominates the frame.

Set confidence below 0.5 only when the title and image genuinely conflict.

Also classify how the garment is presented, which decides whether it needs cleaning up
before rendering:
  - clean_product_shot   — garment alone (flat-lay, ghost mannequin, hanger) on a plain
                           background, facing forward, fully visible. Ideal already.
  - on_model_front       — worn by a person, facing the camera, garment mostly unobstructed.
  - on_model_angled      — worn at a three-quarter or side angle, or partly hidden by arms,
                           hair or props.
  - cluttered_or_cropped — busy background, heavy styling, or the garment is cut off.

Also list, in "covers", which body regions this image ACTUALLY SHOWS a garment for:
  - upper_body — a top of any kind is visible
  - lower_body — trousers, shorts, a skirt or the lower half of a dress is visible
  - shoes      — footwear is visible

Report only what you can see. A photo cropped at the waist covers upper_body alone, even
though the person is obviously wearing something below. A flat-lay of one t-shirt covers
upper_body alone. This list decides which parts of a look can be transferred, so guessing
would put clothing on someone that was never in the picture.

Keep "reason" to one short sentence a shopper would understand, naming the garment.
Keep "description" to a short noun phrase: colour, material or pattern, then garment.`;

/**
 * @param {string} imageDataUrl the normalised garment image as a data URL.
 *   Bytes rather than a URL deliberately: passing the retailer URL made the call
 *   depend on OpenAI being able to fetch that CDN, which broke on AJIO (AVIF) and
 *   on any URL that had been truncated or required headers.
 * @param {string} [productTitle] the listing's brand + name, e.g. "HRX Rapid Dry Running Tracksuit".
 *   Strongly improves category accuracy — the photo alone can't tell a tracksuit set
 *   apart from a jacket, but the title can.
 * @returns {Promise<{isApparel: boolean, category: string|null, confidence: number, reason: string, description: string}>}
 */
export async function inspectGarment(imageDataUrl, productTitle = '') {
  const res = await runLimited(() => getClient().chat.completions.create({
    model: MODEL,
    reasoning_effort: 'low', // classification, not deliberation — keeps this off the critical path
    messages: [
      { role: 'system', content: PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: productTitle
              ? `Product title: "${productTitle}"\n\nScreen this product image.`
              : 'No product title available. Screen this product image.',
          },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'garment_screening', strict: true, schema: SCHEMA },
    },
  }));

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error('Garment screening returned an empty response.');

  const parsed = JSON.parse(raw);
  return {
    isApparel: parsed.is_apparel,
    category: parsed.category,
    confidence: parsed.confidence,
    reason: parsed.reason,
    description: parsed.description,
    sourceType: parsed.source_type,
    covers: parsed.covers || [],
    separateItems: Boolean(parsed.separate_items),
  };
}

/* ------------------------------------------------------------------ person */

/*
 * The cloth endpoint takes no text prompt — its only inputs are the two file ids,
 * garment_category and change_shoes. So the one remaining lever on output quality
 * is the person photo, and Perfect Corp is explicit about what works: a clear,
 * well-lit, full-body photo with relatively straight posture. Blurry, dim, or
 * complex overlapping poses degrade the render.
 *
 * Catching that at upload — once — is far better than letting every subsequent
 * try-on come out subtly wrong with no explanation.
 */

const PERSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['usable', 'framing', 'issues', 'advice'],
  properties: {
    usable: { type: 'boolean', description: 'False only for problems that will clearly ruin the render.' },
    framing: { type: 'string', enum: ['full_body', 'upper_body_only', 'head_only', 'no_person'] },
    issues: {
      type: 'array',
      items: { type: 'string', enum: ['blurry', 'poor_lighting', 'complex_pose', 'multiple_people', 'obscured', 'low_resolution'] },
      description: 'Only issues actually present and significant.',
    },
    advice: { type: 'string', description: 'One short, friendly, actionable sentence. Empty string if the photo is good.' },
  },
};

const PERSON_PROMPT = `You are checking a photo someone uploaded to a virtual clothing try-on tool.

The try-on engine works best with a clear, well-lit, full-body photo where the person
stands in a relatively straight, front-facing pose. It struggles with blurry or dimly lit
photos, and with complex or overlapping poses.

Set usable=false ONLY for problems that will clearly ruin the result: no person visible,
several people, a head-and-shoulders crop, heavy blur, or a face-covering obstruction.
A merely imperfect photo is still usable — say so and give one tip.

framing: full_body if roughly head-to-feet (or at least mid-thigh down), upper_body_only
if cropped above the knees, head_only for a headshot, no_person if nobody is visible.

"advice" must be one short friendly sentence the person can act on, e.g. "Try a photo
taken from further back so your legs are visible." Return an empty string if the photo
is already good.`;

/**
 * Screens the user's uploaded photo for try-on suitability.
 * @param {Buffer} buffer image bytes
 * @param {string} contentType e.g. "image/jpeg"
 */
export async function inspectPerson(buffer, contentType = 'image/jpeg') {
  const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;

  const res = await runLimited(() => getClient().chat.completions.create({
    model: MODEL,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: PERSON_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Check this photo.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'person_screening', strict: true, schema: PERSON_SCHEMA },
    },
  }));

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error('Photo screening returned an empty response.');
  return JSON.parse(raw);
}
