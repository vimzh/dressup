/**
 * Garment pre-processing.
 *
 * YouCam renders best from a front-facing, isolated garment on a clean
 * background with every detail visible. Retail listing photos frequently are
 * not that: the garment is worn by a model at a three-quarter angle, cropped,
 * partly occluded by arms, or shot against a busy set. Feeding those in is where
 * the deformed and hallucinated outputs come from.
 *
 * So a garment is normalised into that ideal form before it reaches YouCam.
 *
 * The obvious risk is that a generative model asked to "clean up" a garment
 * invents detail — a different print, a moved logo, a changed neckline — which
 * would be worse than the problem it solves. Three things guard against that:
 *
 *   1. Prep only runs when the source is actually poor. A clean flat-lay is
 *      passed through untouched.
 *   2. `input_fidelity: 'high'` tells the image model to preserve the input's
 *      detail rather than reinterpret it.
 *   3. Every prepped image is compared against the original by a vision check,
 *      and anything that drifted is discarded in favour of the original.
 *
 * The original is always the fallback. Prep can improve a render; it is never
 * allowed to corrupt one.
 */

import OpenAI from 'openai';
import { runLimited } from './limiter.js';
import { toFile } from 'openai/uploads';
import sharp from 'sharp';

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const VISION_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

let client;
function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const PREP_PROMPT = `Reproduce ONLY the main garment from this photo as a clean product shot.

Output requirements:
- The garment alone, laid flat and facing straight forward, filling most of the frame.
- Plain pure-white background. No person, no mannequin, no hanger, no props, no shadows
  beyond a soft contact shadow.
- Symmetrical and unwrinkled, sleeves and hems fully visible and not cropped.

Preservation requirements — these override everything else:
- Reproduce the EXACT colour, pattern, print, texture and fabric of the original.
- Reproduce every logo, graphic, text, button, zip, pocket and seam exactly where it is.
- Do NOT redesign, restyle, complete, tidy or "improve" the garment. Do not invent detail
  that is not visible in the source. Do not change the cut, length, neckline or fit.

If part of the garment is hidden in the source, extend it in the plainest, most literal way
consistent with what IS visible. Never guess a pattern onto a hidden area.`;

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['faithful', 'issues', 'reason'],
  properties: {
    faithful: {
      type: 'boolean',
      description: 'True only if the second image is unmistakably the same garment as the first.',
    },
    issues: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['colour_changed', 'pattern_changed', 'logo_changed', 'shape_changed', 'detail_invented', 'wrong_garment'],
      },
    },
    reason: { type: 'string', description: 'One short sentence.' },
  },
};

const VERIFY_PROMPT = `The first image is an original product photo. The second is a cleaned-up
version of the same garment that will be used for a virtual try-on.

Decide whether the second image is faithful to the garment in the first. Judge only the garment,
not the background, the pose, or whether a person is present — those are expected to differ.

Set faithful=false if the colour, pattern, print, logo placement, neckline, sleeve length or
overall cut differ, or if detail was invented that is not present in the original. Small changes
in lighting, wrinkles or drape are fine.

Be strict: a wrong garment reaching the renderer is worse than skipping the cleanup.`;

const dataUrl = (buf, type = 'image/jpeg') => `data:${type};base64,${buf.toString('base64')}`;

/**
 * Compares the prepped garment against the original.
 * @returns {Promise<{faithful: boolean, issues: string[], reason: string}>}
 */
async function verifyFaithful(originalBuf, preppedBuf) {
  const res = await runLimited(() => getClient().chat.completions.create({
    model: VISION_MODEL,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: VERIFY_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Original:' },
          { type: 'image_url', image_url: { url: dataUrl(originalBuf), detail: 'low' } },
          { type: 'text', text: 'Cleaned-up version:' },
          { type: 'image_url', image_url: { url: dataUrl(preppedBuf), detail: 'low' } },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'fidelity', strict: true, schema: VERIFY_SCHEMA } },
  }));
  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error('Fidelity check returned an empty response.');
  return JSON.parse(raw);
}

/**
 * Normalises a garment photo for YouCam.
 *
 * @param {Buffer} buffer normalised garment image
 * @param {{sourceType?: string, description?: string}} garment screening output
 * @returns {Promise<{buffer: Buffer, prepped: boolean, why: string}>}
 *   Always returns something usable — the original on any failure.
 */
export async function prepareGarment(buffer, garment = {}) {
  // A clean flat-lay is already the target format; touching it is pure risk.
  if (garment.sourceType === 'clean_product_shot') {
    return { buffer, prepped: false, why: 'already a clean product shot' };
  }

  try {
    const png = await sharp(buffer).resize(1024, 1024, { fit: 'inside' }).png().toBuffer();

    const base = {
      model: IMAGE_MODEL,
      image: await toFile(png, 'garment.png', { type: 'image/png' }),
      prompt: PREP_PROMPT,
      size: '1024x1024',
    };

    /*
     * `input_fidelity: 'high'` is the strongest guard against the model
     * reinterpreting the garment, but only some image models accept it — it is
     * offered first and dropped if the API rejects it, rather than pinning the
     * whole feature to one model id.
     */
    let res;
    try {
      res = await runLimited(() => getClient().images.edit({ ...base, input_fidelity: 'high' }));
    } catch (err) {
      if (!/input_fidelity/i.test(String(err?.message))) throw err;
      res = await runLimited(() => getClient().images.edit(base));
    }

    const b64 = res.data?.[0]?.b64_json;
    if (!b64) return { buffer, prepped: false, why: 'image model returned nothing' };

    const prepped = await sharp(Buffer.from(b64, 'base64'))
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92 })
      .toBuffer();

    const check = await verifyFaithful(buffer, prepped);
    if (!check.faithful) {
      return { buffer, prepped: false, why: `rejected — ${check.issues.join(', ') || check.reason}` };
    }

    return { buffer: prepped, prepped: true, why: 'cleaned to a front-facing product shot' };
  } catch (err) {
    // Prep is an enhancement. If it fails for any reason the render still happens.
    return { buffer, prepped: false, why: `skipped — ${String(err.message).slice(0, 90)}` };
  }
}
