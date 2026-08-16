/**
 * The expert opinion.
 *
 * Every other OpenAI call in this project is a gate — screen the garment, screen
 * the photo, locate a piece in a collage. This one is the opposite: it looks at
 * a finished render and says something useful about it, the way a friend who
 * knows clothes would if you turned around and asked.
 *
 * Two shapes, one model:
 *
 *   1. `opinion()` — the first response, always the same three questions a
 *      shopper actually has: does it look good, does it suit *me*, and what do
 *      I wear it with. Structured, because the panel lays those out as sections
 *      and colour swatches rather than a wall of prose.
 *   2. `reply()` — anything they ask next ("what pants would go with this?").
 *      Free text, short, and given the same image plus the opinion already on
 *      screen so it doesn't contradict itself two lines later.
 *
 * The render is the subject in both cases, not the product photo: the whole
 * point is advice on the garment *as worn by this person*.
 */

import OpenAI from 'openai';
import { runLimited } from './limiter.js';

/*
 * Screening is tuned for latency because it sits in front of a render. This
 * doesn't — nothing is waiting on it — so it gets a higher image detail and
 * medium effort, which is the difference between "this is a nice blue shirt"
 * and advice that names the cut and the shoulder line. Override to go further.
 */
const MODEL = process.env.OPENAI_STYLIST_MODEL || 'gpt-5.4-mini';

let client;
function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set. Copy apps/api/.env.example to apps/api/.env and fill it in.');
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/*
 * The one line that matters most here. A stylist who only ever says "gorgeous!"
 * is worth nothing, and one who comments on the body rather than the clothes is
 * worse than nothing — this is a photo of the user, and they did not ask to be
 * appraised. So: judge the garment, never the person; talk about proportion and
 * line, never size, weight or shape as a problem to fix.
 */
const VOICE = `You are a working fashion stylist giving a quick, honest read on an outfit
someone has just tried on virtually. The image is a virtual try-on render of the user
themselves wearing the piece.

How you talk:
- Specific, never generic. Name what you actually see — the cut, the neckline, the hem, the
  fabric's weight, where it sits on the body. "The boxy hem cuts you at the widest point of
  the hip" is useful; "this is a stylish look" is not.
- Honest. If the proportions fight each other or the colour drains the skin tone, say so
  plainly and say what to change. Praise only what deserves it.
- Judge the clothes, never the person. Talk about line, proportion and balance. Never comment
  on the person's size, weight or body as something to correct or hide, and never guess at
  their gender, age or ethnicity — style the garment for the frame you can see.
- Remember it is a render. If something reads as a rendering artefact rather than a real fit
  problem (a warped print, a smeared hemline), ignore it rather than critiquing it.
- Plain English. No fashion-copy adjectives, no hype, no emoji, no bullet symbols.`;

const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'looks', 'fit', 'colors', 'tips'],
  properties: {
    headline: {
      type: 'string',
      description: 'One short verdict line, under 12 words. The takeaway if they read nothing else.',
    },
    looks: {
      type: 'string',
      description:
        'How the piece looks: cut, silhouette, colour, styling, what it reads as. Two or three sentences.',
    },
    fit: {
      type: 'string',
      description:
        'How it sits on this person specifically — proportion, where it breaks, what it balances or exaggerates, and what to adjust (sizing, tucking, length). Two or three sentences about the garment on the frame, never about the body itself.',
    },
    colors: {
      type: 'array',
      description: 'Three or four colours to pair this with, most useful first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'hex', 'why'],
        properties: {
          name: { type: 'string', description: 'Plain colour name, e.g. "warm sand".' },
          hex: { type: 'string', description: 'The colour as #rrggbb, for the swatch.' },
          why: { type: 'string', description: 'Under 12 words on why it works with this piece.' },
        },
      },
    },
    tips: {
      type: 'array',
      description: 'Two or three concrete next moves — a garment to pair, a styling change, an occasion it suits.',
      items: { type: 'string' },
    },
  },
};

/** What the render is of, in as few words as the model needs. */
function describeSubject(context = {}) {
  const lines = [];
  if (context.title) lines.push(`Item: ${context.title}`);
  if (context.pieces?.length) lines.push(`Pieces worn: ${context.pieces.join(', ')}`);
  if (context.category) lines.push(`Category: ${context.category}`);
  if (context.site) lines.push(`From: ${context.site}`);
  return lines.join('\n') || 'No product details were captured for this render.';
}

const imagePart = (dataUrl) => ({ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } });

/**
 * The opening expert opinion on a render.
 *
 * @param {string} imageDataUrl the render, as a data URL
 * @param {{title?: string, pieces?: string[], category?: string, site?: string}} context
 */
export async function opinion(imageDataUrl, context = {}) {
  const res = await runLimited(() =>
    getClient().chat.completions.create({
      model: MODEL,
      reasoning_effort: 'medium',
      messages: [
        { role: 'system', content: VOICE },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${describeSubject(context)}\n\nGive your read on this try-on.`,
            },
            imagePart(imageDataUrl),
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'stylist_opinion', strict: true, schema: ADVICE_SCHEMA },
      },
    })
  );

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error('The stylist had nothing to say — try again.');

  const parsed = JSON.parse(raw);
  return {
    headline: parsed.headline,
    looks: parsed.looks,
    fit: parsed.fit,
    // A malformed hex would paint a swatch black and look like a bug rather than
    // a missing value, so anything that isn't a colour is dropped to null.
    colors: (parsed.colors || []).map((c) => ({
      name: c.name,
      hex: /^#[0-9a-f]{6}$/i.test(c.hex || '') ? c.hex : null,
      why: c.why,
    })),
    tips: parsed.tips || [],
  };
}

/*
 * Follow-ups. The image goes back with every turn: the conversation is entirely
 * about what is in it, and a two-line question ("with what shoes?") is
 * meaningless without it.
 *
 * History is capped because nothing here needs long memory, and an unbounded
 * thread is an unbounded bill.
 */
const MAX_TURNS = 10;

/**
 * @param {string} imageDataUrl the render, as a data URL
 * @param {object} context see `opinion`
 * @param {object|null} priorOpinion the structured opinion already on screen, so
 *   the reply builds on it instead of repeating or contradicting it
 * @param {Array<{role: 'user'|'assistant', content: string}>} messages
 */
export async function reply(imageDataUrl, context, priorOpinion, messages = []) {
  const turns = messages.slice(-MAX_TURNS).filter((m) => m?.content && (m.role === 'user' || m.role === 'assistant'));
  if (!turns.length) throw new Error('Ask a question first.');

  const brief = priorOpinion
    ? `You already told them: "${priorOpinion.headline}" — ${priorOpinion.looks} ${priorOpinion.fit}`
    : 'You have not given your opening read on this yet.';

  const res = await runLimited(() =>
    getClient().chat.completions.create({
      model: MODEL,
      reasoning_effort: 'low', // a chat reply, not a full appraisal
      messages: [
        {
          role: 'system',
          content: `${VOICE}

They are now asking follow-up questions about this same try-on. ${brief}

Answer only what was asked, in at most three short sentences. Be concrete: name colours,
fabrics, cuts and lengths rather than describing a vibe. When they ask what to pair with it,
give two or three specific options, not a category. If the question is not about clothes or
this look, say so in one line and steer back.`,
        },
        {
          role: 'user',
          content: [{ type: 'text', text: describeSubject(context) }, imagePart(imageDataUrl)],
        },
        ...turns.map((m) => ({ role: m.role, content: String(m.content).slice(0, 600) })),
      ],
    })
  );

  const text = res.choices[0]?.message?.content?.trim();
  if (!text) throw new Error('The stylist had nothing to say — try asking again.');
  return text;
}
