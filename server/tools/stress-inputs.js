#!/usr/bin/env node
/**
 * Which garment input does YouCam actually render best from?
 *
 * The published guidance covers the *person* photo and says nothing specific
 * about the garment reference, and third-party advice ("flat-lay and ghost
 * mannequin both work well") is not evidence about this engine. So this builds
 * ten variants of the same garment, renders each on the same person, and scores
 * the outputs blind.
 *
 * Six variants are pure image operations, so the garment pixels are untouched
 * and any difference is attributable to framing or background alone. Four are
 * generatively rebuilt, which is the only way to get a true flat-lay or ghost
 * mannequin out of an on-model photo — and also the variants most at risk of
 * inventing detail, which the scoring is designed to catch.
 *
 *   node tools/stress-inputs.js [--garment URL] [--title "..."] [--person path]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

import { uploadImage, createClothTask, pollClothTask } from '../src/youcam.js';
import { normalizeImage, toDataUrl } from '../src/image.js';
import { inspectGarment } from '../src/garment.js';

const OUT = path.join(os.homedir(), 'zdress-stress');
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const JUDGE_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};

const GARMENT_URL = arg(
  'garment',
  'https://assets.myntassets.com/q_90,w_1080,c_limit,fl_progressive/assets/images/2026/JULY/17/ARwzVG4U_878343743de74321a6a8a13e4521352d.jpg'
);
const TITLE = arg('title', 'HRX by Hrithik Roshan Rapid Dry Running Tracksuit');
const PERSON = arg('person', path.join(os.homedir(), 'Downloads/model.jpg'));

/* ------------------------------------------------------------------ variants */

const pad = (buf, bg) =>
  sharp(buf)
    .resize(1024, 1024, { fit: 'contain', background: bg })
    .flatten({ background: bg })
    .jpeg({ quality: 92 })
    .toBuffer();

/** Generatively rebuild the garment with a given presentation. */
async function rebuild(buf, instruction, label) {
  const png = await sharp(buf).resize(1024, 1024, { fit: 'inside' }).png().toBuffer();
  const base = {
    model: IMAGE_MODEL,
    image: await toFile(png, 'g.png', { type: 'image/png' }),
    prompt: `${instruction}

Preserve the EXACT colour, pattern, print, texture, logos, text, seams and cut of the original
garment. Do not redesign, restyle or complete it. Do not invent detail that is not visible.`,
    size: '1024x1024',
  };
  let res;
  try {
    res = await openai.images.edit({ ...base, input_fidelity: 'high' });
  } catch (err) {
    if (!/input_fidelity/i.test(String(err?.message))) throw err;
    res = await openai.images.edit(base);
  }
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${label}: image model returned nothing`);
  return sharp(Buffer.from(b64, 'base64')).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
}

const VARIANTS = [
  { id: '01-control', desc: 'Original listing photo, untouched', build: async (b) => b },
  { id: '02-white-pad', desc: 'Contained on white, square', build: (b) => pad(b, '#ffffff') },
  { id: '03-black-pad', desc: 'Contained on black, square', build: (b) => pad(b, '#000000') },
  { id: '04-grey-pad', desc: 'Contained on mid-grey, square', build: (b) => pad(b, '#808080') },
  {
    id: '05-tight-crop',
    desc: 'Cropped in to fill the frame with the garment',
    build: async (b) => {
      const m = await sharp(b).metadata();
      const w = Math.round(m.width * 0.72);
      const h = Math.round(m.height * 0.72);
      return sharp(b)
        .extract({ left: Math.round((m.width - w) / 2), top: Math.round(m.height * 0.06), width: w, height: h })
        .jpeg({ quality: 92 })
        .toBuffer();
    },
  },
  {
    id: '06-sharpened',
    desc: 'Original with contrast and sharpening lifted',
    build: (b) => sharp(b).modulate({ brightness: 1.04 }).linear(1.12, -12).sharpen({ sigma: 1.1 }).jpeg({ quality: 95 }).toBuffer(),
  },
  {
    id: '07-flatlay-white',
    desc: 'Rebuilt as a flat-lay on white',
    build: (b) => rebuild(b, 'Show ONLY this garment laid flat, facing forward, on a pure white background. No person, no mannequin, no hanger, no props.', 'flatlay'),
  },
  {
    id: '08-ghost-mannequin',
    desc: 'Rebuilt as a ghost mannequin on white',
    build: (b) => rebuild(b, 'Show ONLY this garment as a ghost-mannequin product shot — filled out in a natural worn shape with the body invisible — facing forward on a pure white background. No person, no visible mannequin.', 'ghost'),
  },
  {
    id: '09-flatlay-grey',
    desc: 'Rebuilt as a flat-lay on light grey',
    build: (b) => rebuild(b, 'Show ONLY this garment laid flat, facing forward, on a plain light grey studio background. No person, no mannequin, no props.', 'flatgrey'),
  },
  {
    id: '10-flatlay-black',
    desc: 'Rebuilt as a flat-lay on black',
    build: (b) => rebuild(b, 'Show ONLY this garment laid flat, facing forward, on a plain black background. No person, no mannequin, no props.', 'flatblack'),
  },
];

/* -------------------------------------------------------------------- judge */

const SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['garment_fidelity', 'anatomy', 'realism', 'defects', 'note'],
  properties: {
    garment_fidelity: { type: 'integer', description: '1-5. Does the rendered garment match the reference in colour, pattern, logo and cut?' },
    anatomy: { type: 'integer', description: '1-5. Is the body correct — hands, arms, proportions, no melting or extra limbs?' },
    realism: { type: 'integer', description: '1-5. Does it read as a real photograph rather than a composite?' },
    defects: {
      type: 'array',
      items: { type: 'string', enum: ['deformed_hands', 'deformed_body', 'garment_wrong_colour', 'garment_wrong_pattern', 'logo_lost', 'garment_missing', 'blurry', 'artefacts', 'wrong_category_applied', 'none'] },
    },
    note: { type: 'string', description: 'One short sentence on the biggest problem, or what is good.' },
  },
};

async function judge(referenceBuf, renderBuf) {
  const res = await openai.chat.completions.create({
    model: JUDGE_MODEL,
    reasoning_effort: 'low',
    messages: [
      {
        role: 'system',
        content: `You are grading virtual try-on output. The first image is the ORIGINAL product
listing photo — the ground truth for what the garment looks like. The second is a render of a
person wearing it.

Score 1-5 on garment fidelity, anatomy and realism. Be harsh: 5 means indistinguishable from a
real photo of that exact garment on that person. Judge the garment against the reference, not
against the pose or background, which are expected to differ.`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reference product photo:' },
          { type: 'image_url', image_url: { url: toDataUrl(referenceBuf) } },
          { type: 'text', text: 'Render to grade:' },
          { type: 'image_url', image_url: { url: toDataUrl(renderBuf) } },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'score', strict: true, schema: SCORE_SCHEMA } },
  });
  return JSON.parse(res.choices[0].message.content);
}

/* --------------------------------------------------------------------- run */

fs.mkdirSync(path.join(OUT, 'inputs'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'renders'), { recursive: true });

const rawGarment = Buffer.from(await (await fetch(GARMENT_URL)).arrayBuffer());
const { buffer: garment } = await normalizeImage(rawGarment);
fs.writeFileSync(path.join(OUT, 'inputs', '00-reference.jpg'), garment);

const screening = await inspectGarment(toDataUrl(garment), TITLE);
console.log(`garment: ${TITLE}`);
console.log(`category: ${screening.category}  source_type: ${screening.sourceType}\n`);

const personBuf = (await normalizeImage(fs.readFileSync(PERSON))).buffer;
const personFileId = await uploadImage(personBuf, { fileName: 'p.jpg', contentType: 'image/jpeg', kind: 'cloth' });

console.log('building variants…');
const built = [];
for (const v of VARIANTS) {
  try {
    const buf = await v.build(garment);
    fs.writeFileSync(path.join(OUT, 'inputs', `${v.id}.jpg`), buf);
    built.push({ ...v, buf });
    console.log(`  ✓ ${v.id}`);
  } catch (err) {
    console.log(`  ✗ ${v.id}: ${String(err.message).slice(0, 80)}`);
  }
}

console.log('\nrendering…');
const results = [];
const queue = [...built];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const v = queue.shift();
      const t0 = Date.now();
      try {
        const gid = await uploadImage(v.buf, { fileName: 'g.jpg', contentType: 'image/jpeg', kind: 'cloth' });
        const tid = await createClothTask({
          personFileId,
          garmentFileId: gid,
          garmentCategory: screening.category || 'auto',
          changeShoes: screening.category === 'shoes',
        });
        const url = await pollClothTask(tid);
        const render = Buffer.from(await (await fetch(url)).arrayBuffer());
        fs.writeFileSync(path.join(OUT, 'renders', `${v.id}.jpg`), render);

        const score = await judge(garment, render);
        const total = score.garment_fidelity + score.anatomy + score.realism;
        results.push({ id: v.id, desc: v.desc, ...score, total });
        console.log(`  ${v.id.padEnd(20)} fidelity ${score.garment_fidelity}  anatomy ${score.anatomy}  realism ${score.realism}  = ${total}/15  (${Math.round((Date.now() - t0) / 1000)}s)`);
      } catch (err) {
        console.log(`  ${v.id.padEnd(20)} FAILED: ${String(err.message).slice(0, 70)}`);
        results.push({ id: v.id, desc: v.desc, failed: String(err.message).slice(0, 120), total: -1 });
      }
    }
  })
);

results.sort((a, b) => b.total - a.total);
fs.writeFileSync(path.join(OUT, 'scores.json'), JSON.stringify({ garment: TITLE, category: screening.category, sourceType: screening.sourceType, results }, null, 1));

console.log('\n=== ranking ===');
for (const r of results) {
  if (r.failed) { console.log(`  --/15  ${r.id.padEnd(20)} FAILED`); continue; }
  const d = (r.defects || []).filter((x) => x !== 'none');
  console.log(`  ${String(r.total).padStart(2)}/15  ${r.id.padEnd(20)} ${r.desc}${d.length ? `  [${d.join(', ')}]` : ''}`);
}
console.log(`\n-> ${OUT}`);
