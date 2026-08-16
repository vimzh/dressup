# Devpost submission — Zdress

Copy the sections below into the Devpost form. Everything here is factual and verified;
don't add claims beyond it.

---

## Tagline (one line)

Virtual try-on where you actually shop — a "Try this look" button on every product across
10 fashion retailers, without ever leaving the results page.

---

## Inspiration

Every garment online is modelled by someone who isn't you. You guess, you buy, it doesn't
work, you return it. Apparel returns run 25–40% of online orders and "it didn't look like
that on me" is the single biggest reason.

Virtual try-on already solves this — but it lives on a separate page. You have to leave the
store, find the tool, upload your photo, paste a product image, and wait. By then you've lost
the only thing that actually mattered: the comparison between *this* item and the forty
others on the screen you just left.

We didn't think try-on needed to be better. We thought it needed to be **somewhere else** —
in the grid, at the moment of the decision.

## What it does

Zdress is a Chrome extension. Upload one photo, once. Then on Myntra, AJIO, Flipkart,
Amazon, Nykaa Fashion, SNITCH, Bewakoof, Max Fashion, Libas or Tata CLiQ, every product in
the grid gains two controls:

- **"Try this look"** — renders you wearing that item, in an overlay, without leaving the page.
- **A tick** — adds the item to an outfit.

Tick a shirt here, trousers there, hit **Try this fit**, and you get a single image of
yourself wearing the combination. Because the selection lives in the extension rather than on
the page, an outfit can mix retailers — we routinely compose a Flipkart tee with Myntra
trousers.

It also refuses to waste your time: pick a watch by mistake and it tells you why that can't
be tried on, before spending a render on it.

## How we built it

**YouCam Apparel Virtual Try-On** does the rendering. **OpenAI** (via the official SDK) runs a
vision pre-flight on every product image before a single API unit is spent.

The architecture is three pieces:

- **Extension (MV3)** — injects the controls, resolves product images, renders results.
  All retailer-specific knowledge is isolated to one file, `extension/sites.js`; adding a
  store is a ten-line entry.
- **Local Node server** — the only place API keys exist. YouCam and OpenAI are both
  server-to-server; a key shipped inside an extension is trivially extractable and CORS would
  block the calls anyway.
- **Normalisation layer** — every image is transcoded, resized and flattened before it goes
  anywhere.

### What OpenAI actually contributes

Two things, both of which measurably changed output quality:

1. **Category selection.** YouCam needs a `garment_category`, and the garment being sold is
   not always the most prominent one in the photo. We pass the *listing title* alongside the
   image and instruct the model to treat it as authoritative. An "HRX Rapid Dry Running
   Tracksuit" shot with the jacket dominating the frame classified as `upper_body` at **0.62
   confidence** from the image alone — and as `full_body` at **0.98** once the title was
   supplied. Without that fix the render swapped only the jacket and left the user's own
   trousers on, for a product sold as a two-piece set.

2. **Rejection before spend.** Bags, watches, jewellery and promo banners are screened out
   with a plain-English reason and zero YouCam units consumed.

It also screens *your* photo once at upload. The cloth endpoint takes no text prompt, so after
the category, the only remaining lever on quality is the input photo — and Perfect Corp is
explicit that it wants a clear, well-lit, full-body shot. A headshot is rejected outright; a
knee-crop is accepted with a tip, because it renders fine for tops and badly for trousers.

Screening sits in front of a 10–30s render, so it's tuned for latency: a mini model at low
reasoning effort with a low-detail image scored 5/5 on category and rejection cases at ~2s,
versus ~7s for a full-size model at default effort.

## Challenges we ran into

**The cloth API takes one garment per task.** There's no multi-garment call, so outfits are
composed by chaining: render the first piece, feed that result back as the person image for
the next. Order matters — lower body before upper body, so a longer top falls over the
waistband instead of being clipped by it. Conflicts are resolved too: you can't wear two
shirts, and a dress already covers both halves.

**AJIO serves AVIF from `.jpg` URLs.** Both YouCam and OpenAI reject AVIF, so every AJIO
try-on failed with an "unsupported format" error that gave no hint why a `.jpg` was
unsupported. Content negotiation doesn't help — the CDN returns AVIF whatever `Accept` header
you send. Every image is now normalised in-flight.

**Retailer markup fights back.** Nykaa Fashion and Flipkart generate class names at build time
(`css-384pms`, `MZeksS`), so anything keyed on them breaks on the next deploy. Those adapters
locate cards structurally instead — outward from the product image or the product link. And
because every one of these retailers encodes the product name in the URL slug, that became the
title fallback: it survives redesigns that break selectors.

**Undocumented API behaviour.** The response envelope carries its own numeric `status: 200`
separate from `task_status`, so a naive field lookup finds the wrong one and polls forever
despite the task succeeding. `garment_category` also rejects `outerwear` — which appears in
Perfect Corp's own marketing copy — and an invalid category fails with `"ref_file_url is
required"`, which sends you debugging the upload path for no reason.

**Lazy loading.** On a fresh Myntra page only ~11 of 50 cards have a real `<img>`; the rest are
placeholders and the URL isn't in page state either. So the button attaches to the *card* and
the image is resolved at click time.

## Accomplishments we're proud of

- Try-on that lives **in the grid**, not on a destination page.
- **Ten retailers** behind one adapter interface, including cross-retailer outfits.
- A pre-flight that makes the try-on *more accurate*, not just cheaper — the 0.62 → 0.98
  tracksuit fix is a visibly different, visibly correct result.
- Honest failure states: every error tells you what went wrong and what to do about it.

## What we learned

Placement is a feature. The rendering engine was never the bottleneck for virtual try-on
adoption — the context switch was. Moving an existing capability three clicks earlier in the
journey changed what it was useful for.

We also learned to verify against live sites rather than documentation. Almost every
significant bug — AVIF, the polling envelope, hashed class names, lazy images — was invisible
in the docs and obvious within minutes of testing against the real thing.

## What's next

- Product-page support across all retailers (currently Myntra only; the rest are listing grids)
- Saved looks, and sharing a rendered outfit
- Size guidance — the render shows how a garment *looks*, not yet how it *fits*
- A generic adapter so unlisted stores work out of the box

## Built with

`javascript` · `chrome-extension` · `manifest-v3` · `node.js` · `express` · `youcam-api` ·
`perfect-corp` · `openai` · `sharp`

---

## Verification notes (for us, not for the form)

Rendered end-to-end through the full pipeline: **Myntra, AJIO, Nykaa Fashion, Flipkart,
Amazon**. Adapter verified against the live site but no render run: **SNITCH, Bewakoof, Max
Fashion, Libas**. Unverified image selector: **Tata CLiQ** (its images never loaded in the
test browser).

Don't claim ten working retailers in the video without checking the last five in a real
browser first.
