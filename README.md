# Zdress — virtual try-on where you actually shop

<img src="extension/shared/icons/icon128.png" width="72" alt="Zdress">

A Chrome and Firefox extension that puts a **"Try this look"** button on every product across ten fashion
retailers — **Myntra, AJIO, Flipkart, Amazon, Nykaa Fashion, SNITCH, Bewakoof, Max Fashion,
Libas and Tata CLiQ**. Upload your photo once; click any product and the card's photo becomes
*you* wearing it, without leaving the page.

Built for the [YouCam API Hackathon](https://youcam-api.devpost.com/) using
**YouCam Apparel Virtual Try-On** and the **OpenAI SDK**.

---

## The problem

Every garment online is modelled by someone who isn't you. You guess, you buy, you return.
Apparel returns run 25–40% of online orders, and "it didn't look like that on me" is the
single biggest reason.

Virtual try-on tools exist — but they live on a separate page. You have to leave the store,
find the tool, re-upload your photo, and paste a product image. By then you've lost the
thing that mattered: the comparison between *this* item and the forty others on screen.

## The idea

**Try-on belongs in the grid, not in a separate destination.** Zdress puts it exactly where
the decision happens. Your photo is uploaded once and reused for every product, so trying on
the fifth item is one click, not another round of setup.

---

## Building a whole fit

Each card carries two controls: **"Try this look"** on the right, and a **tick** on the left.

Clicking "Try this look" **replaces that card's product photo with the render, in place**. No
modal, no context switch — the grid becomes a grid of you, and you keep scrolling. Each swapped
card gets a revert button to bring the product photo back, and a save button.

The tick adds a piece to an outfit. Tick a top here, trousers there, then hit **Try this fit**
in the side panel — the combined render appears **in the panel**, which stays open while you
keep browsing. (A side panel keeps focus when you click the page; a popup would not, which is
why this originally lived in a page overlay.)

The selection lives in extension storage rather than on the page, so an outfit can mix retailers:
a tee from Flipkart with trousers from Myntra composes into a single render.

### How multiple garments are combined

YouCam's cloth task accepts exactly one `ref_file_id`, so an outfit can't be produced in one
call. Instead each piece is applied in turn, with the previous render becoming the person image
for the next step. Two rules make the result coherent:

- **Layer order.** Lower body goes on before upper body, so a longer top falls over the
  waistband instead of being clipped by it. Shoes go last.
- **Slot conflicts.** You can't wear two shirts, and a full-body piece (dress, tracksuit)
  already covers both halves — so those picks are dropped, and the result says which and why.

Non-apparel picks are rejected during screening, before any render time is spent: tick a watch
by accident and the outfit still renders, with a note explaining the watch was left out.

The cost is time — each piece is its own render, so a three-piece fit takes roughly a minute.

## Pinterest

Pinterest is the opposite shape to a shop: a pin is a look, not a product with a slot, and
there is nothing to buy. So a click there applies **everything YouCam supports** rather than one
garment — and pins come in two forms, both handled:

- **Someone wearing a look** → sent straight through as `full_body` with `change_shoes` on.
- **A moodboard** — a cap, a tee, a tote, shorts and trainers laid out separately — which is by
  far the more common fashion pin. YouCam cannot take that as one garment, and screening rightly
  calls it a collage.

### Only what the pin actually shows

Plenty of pins show part of a look — cropped at the waist, or a board with just a top and
shoes. Applying "the whole outfit" to those is how you get invented clothing: forcing
`full_body` on a waist-up jacket shot leaves YouCam with no lower-body reference, and it fills
the gap itself. Tested, it returned cropped black leggings that were nowhere in the source.

So screening reports which body regions the image *actually shows a garment for*, and the
whole-look upgrade only happens when both halves are really there. A partial pin transfers the
part it has and leaves the rest of what you're wearing alone. Shoes are swapped only when the
pin actually shows footwear.

A moodboard is still an outfit; it is just pre-separated. So the wearable pieces are located,
cut out, and run through the same chain that composes a tick-built fit. On the pin used to build
this, that found three pieces — tee, denim shorts, trainers — and correctly skipped the cap and
the tote, neither of which YouCam can render.

### A board is not a co-ord set

Screening alone was not a reliable gate for this. Measured across four baggy-denim boards, one
came back `is_apparel: true`, `full_body`, confidence 0.58 — read as a *coordinated set*, which
is a fair description of "a shirt and trousers sold together" and a terrible one for a shirt,
some jeans and a pair of trainers laid out with gaps between them. When that happens the split
never runs and the **entire board** goes to YouCam as one garment. It has nothing to say how
long the legs are, so it guesses, and short ones are a perfectly plausible guess — which is
exactly how full-length jeans come back as shorts.

So screening now reports `separate_items` as its own signal, and a pin that is board-shaped is
split whatever category it was given. All four boards now screen as boards at 0.98–0.99, while
a real tracksuit listing still classifies `full_body` at 0.99 with and without its title, and
worn-look pins are untouched.

### Cutting a piece out without cutting it short

Three things were wrong with the crops themselves, all of which put the wrong garment in front
of YouCam:

- **The box that stops at the knee.** The crop *is* the garment as far as the render is
  concerned, so jeans clipped mid-leg are worn as shorts — faithfully. Each cut-out is now
  screened for whether the garment runs off its own edge, and a piece reported cut off gets one
  retry with those edges opened up. Lower-body boxes also get roughly double padding at the
  bottom, the edge the model most often draws short.
- **A pair of shoes counted as two shoes.** Boxed separately about half the time, which cost an
  extra render pass and sent half a pair in as the reference for a pair. Same-category boxes
  that touch are now unioned, and only the largest per slot survives — the rule `/api/outfit`
  already applies to ticked items.
- **Squaring a 1:3 garment.** Crops were padded onto a 1024×1024 canvas, so wide-leg jeans
  occupied a third of the frame with white either side. The canvas now opens only as far as
  3:4, and the garment stays large.

The per-piece check is also its own prompt rather than a second call to product screening.
Product screening exists to decide whether an image is one sellable garment — and now correctly
refuses anything board-shaped, which a crop off a board often looks like, since boards overlap
and a rectangle around the shirt catches the top of the jeans. Pointed at the crops, it threw
away two of three real pieces. The crop is asked a question that fits what it is: of what is
visible here, which garment is the main one, and is all of it in frame?

The locator's own label is deliberately not passed into that check. Screening treats a title as
authoritative, so feeding it a guessed "denim shorts" launders the guess into a fact — it comes
back confirmed as shorts even when the crop plainly holds full-length jeans. A check is only
worth having if it can disagree, so it gets the pixels and nothing else.

Measured on the same four boards: three pieces each, one per slot, hems intact.

**Nothing is generated.** A vision model is asked only for the *location* of each garment; the
cutting is done by sharp, so every output pixel came from the pin. That is deliberate: rebuilding
garments with an image model was measured to lose logos and drop whole pieces (see below). Each
crop is then re-screened, so a box that turns out to hold a tote bag is discarded rather than
rendered.

Pin titles are deliberately ignored. The screening prompt treats a product title as
authoritative, and a pin has nothing that qualifies — the test pin's heading is "Männer Outfit"
and its `og:title` is "90年代 ファッション メンズ". The image alone is the better signal.

## Saving looks

Renders carry a **save** button — on the swapped card for a single piece, under the result for
a fit. Saved looks collect in a full-height **side panel** (Chrome's Side Panel API, Firefox's
sidebar — not a popup), split into two tabs: *Try on* for the current fit, *Saved* for the library. Your photo
lives behind the header avatar in settings, since it is set once and rarely changed.

The panel is user-resizable, so its content is capped at 520px and centred rather than
stretching into an unreadable band; below 340px the library drops to a single column.

Because the selection and the library are both extension-level rather than page-level, a
single collection can hold looks from Myntra, Flipkart and AJIO side by side — the point of
the feature is consolidating across stores.

**Renders are stored as files by the local server, not as links.** YouCam returns pre-signed
URLs that expire after two hours, so a saved link would be a dead image by the next day. The
trade-off is that the library needs the server running; when it isn't, the panel says so
plainly instead of rendering broken thumbnails.

Deleting a collection keeps its looks — they fall back to *Unsorted* rather than vanishing.

## Expert opinion

A try-on answers *what does this look like on me* and immediately raises the one it can't:
**is it any good?** So every render carries an **Expert opinion** button — on the swapped card,
under a rendered fit, and on any saved look you open.

One click returns a stylist's read on the render itself (not the catalogue photo — advice about
a garment on a model is advice about the model), in the three parts a shopper actually wants:

- **how it looks** — cut, silhouette, what it reads as;
- **how it suits you** — where it breaks, what it balances or exaggerates, what to change;
- **colours that work** — three or four pairings, each with a swatch and a reason.

Underneath is an input, because the useful question is usually the specific one: *what trousers
go with this?*, *what shoes work here?*, *can I dress this up?* Follow-ups get the render, the
context and the opinion already on screen, so the answer builds on it instead of restating it.

Two rules are baked into the prompt and matter more than the format:

- **It judges the clothes, never the person.** The image is the user's own body. Line,
  proportion and balance are fair game; size and shape as things to fix are not.
- **It is allowed to say no.** A stylist who only ever says "gorgeous" is worth nothing, so it
  is told to name what fights — and on the test render it opened with "easy casual set, but the
  shorts feel too loungey", which is the point.

Opinions are cached per render: re-opening a saved look is instant and free, and a stylist who
changes their mind between two views of the same picture reads as broken rather than thoughtful.
The opening read costs one call (~5s); each follow-up costs one more (~2s). Screening is tuned
for latency because a render waits on it — this doesn't, so it runs at higher image detail and
effort, on its own `OPENAI_STYLIST_MODEL`.

Asking from a card in the grid hands the render to the side panel and opens it, because a
200px tile inside someone else's page is the wrong place to hold a conversation.

On Firefox the panel doesn't open by itself here, and can't: `sidebarAction.open` is only
callable from a user input handler, and Firefox
[does not count](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/User_actions)
a click that arrived over `runtime.sendMessage` as one. The look is handed over regardless — it's
written to storage before the open is attempted, and the panel picks it up on open — so the
difference is one click: the card says the stylist is waiting, and it is.

## How it works

```
Myntra grid          Extension                 Local backend            APIs
───────────          ─────────                 ─────────────            ────
"Try this look" ───▶ content script
                       │ garment image URL
                       ▼
                     service worker ─────────▶ POST /api/tryon
                                                 │
                                                 ├─▶ OpenAI vision ────▶ screen + categorise
                                                 │                       (reject non-apparel)
                                                 ├─▶ YouCam upload garment
                                                 ├─▶ YouCam create task
                                                 └─▶ poll to completion
                     card render swap ◀──────────┘
```

### Why there's a backend

YouCam and OpenAI are both server-to-server APIs. A key shipped inside an extension is
trivially extractable, and browser CORS would block the calls anyway. The Node server is the
only place secrets exist. It runs on `localhost` — nothing needs to be publicly reachable,
because garment bytes are pushed to YouCam's own pre-signed upload URL.

### What OpenAI does

A vision pre-flight runs on the product image *before* any YouCam unit is spent. It:

- **rejects images that can't produce a meaningful try-on** — bags, watches, jewellery,
  fabric close-ups, promo banners that leak into the grid — with a plain-English reason;
- **picks the `garment_category`**, which matters because the garment being sold isn't always
  the most prominent one in the shot. A listing for shorts, photographed on a model also
  wearing a t-shirt, is `lower_body`. Explicit beats `auto` here.

Crucially it is given the **listing title alongside the image**, and told to treat the title
as authoritative. This is what makes the categorisation reliable: an "HRX Rapid Dry Running
Tracksuit" photographed with the jacket dominating the frame classified as `upper_body` at
0.62 confidence from the image alone, and as `full_body` at 0.98 once the title was supplied.

After the render it does the opposite job: the **expert opinion** above is an OpenAI call over
the finished image, and the only one here that is asked for judgement rather than a gate.

Screening sits on the critical path in front of a 10–30s render, so it is tuned for latency —
a mini model at low reasoning effort with a low-detail image. Measured on real Myntra
listings, that scored 5/5 on category and rejection cases at ~2s, against ~7s for full
`gpt-5` at default effort.

It also screens **your** photo, once, at upload. The cloth endpoint accepts no text prompt —
its only inputs are the two file ids, `garment_category` and `change_shoes` — so after the
category, the sole remaining lever on output quality is the person photo. Perfect Corp is
explicit that it needs a clear, well-lit, full-body photo with straight posture. A headshot
is rejected outright; a photo cropped at the knees is accepted with a tip, because it renders
fine for tops and badly for trousers. Catching that once at upload beats every later try-on
coming out subtly wrong with no explanation.

---

## Setup

### 1. Backend

```bash
cd server && npm install
```

Copy `.env.example` to `.env` and fill in both keys:

- `YOUCAM_API_KEY` — from the [YouCam API console](https://yce.makeupar.com/api-console/en/api-keys/)
- `OPENAI_API_KEY` — from the [OpenAI dashboard](https://platform.openai.com/api-keys)

```bash
npm start
```

Check it's healthy — both flags should read `true`:

```bash
curl -s http://localhost:3000/api/health
```

### 2. Extension

One source tree builds both browsers. From the repo root:

```bash
npm run build
```

That writes `dist/chrome` and `dist/firefox`. No dependencies and no bundler — it copies
`extension/shared`, lays the target's files over it, and merges the manifest.

**Chrome**

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `dist/chrome`

**Firefox** (128 or newer)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select `dist/firefox/manifest.json`

A temporary add-on is removed when Firefox closes, which is the normal way to run an unsigned
extension; `npm run package` produces the zip you'd submit to either store instead.

### 3. Use it

1. Click the Zdress icon and upload a photo — full body, facing forward, plain background works best.
2. Go to any Myntra listing page, e.g. [sportswear](https://www.myntra.com/sports-wear).
3. Hit **Try this look** on any product.

Rendering takes roughly 10–30 seconds.

---

## Layout

```
server/
  src/index.js            Express routes: /api/person, /api/tryon, /api/outfit, /api/advice
  src/youcam.js           YouCam client — upload, create task, poll
  src/garment.js          OpenAI vision pre-flight (garment + person photo)
  src/stylist.js          The expert opinion — structured read, then follow-up chat
  src/image.js            Format/size normalisation (AVIF, HEIC, oversized, alpha)
  src/library.js          Saved looks + collections (files on disk)
  tools/convert-images.js Standalone converter, for files you already have
extension/
  manifest.base.json      MV3 — everything both browsers agree on
  chrome/manifest.json    Service worker + side_panel
  firefox/manifest.json   Event page + sidebar_action + gecko settings
  shared/
    sites.js              Per-retailer adapters — the only site-specific code
    content.js            Button + tick injection, image resolution, result overlay
    content.css           Injected styles (namespaced, !important against retailer CSS)
    background.js         Service worker / event page — all backend calls
    sidepanel.html/js     Side panel — photo, current fit, collections, saved looks
scripts/build.mjs         Assembles dist/chrome and dist/firefox
```

## Two browsers, one source tree

The code is shared whole; only the manifest differs, and only in three places.

**The namespace.** Chrome puts the promise-based APIs on `chrome`, Firefox on `browser`. Every
entry script opens with `globalThis.browser ??= globalThis.chrome` and then uses `browser.*`
throughout — a line rather than a polyfill, because Chrome's MV3 `chrome.*` already returns
promises for everything used here.

**The background.** Firefox
[doesn't implement](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
`background.service_worker`, so it gets an event page from the same file. Nothing in
`background.js` needs a worker specifically.

**The panel.** Chrome's `sidePanel` and Firefox's `sidebarAction` are different APIs for the
same idea and are explicitly not compatible, so `background.js` branches on which one exists.
`sidepanel.html` itself is untouched — it's an extension page either way.

Everything else is the manifest split. `manifest.base.json` holds what both agree on, including
the retailer match list and the version, because those are exactly what rots when two manifests
are kept side by side; `chrome/` and `firefox/` hold only their differences and are merged over
the base at build time. Any other file dropped into a target directory is copied over the shared
build, so a browser-specific override needs no change to the build script.

```bash
npm run build            # both
npm run build:firefox    # one
npm run package          # zips for store submission
npm run lint:firefox     # Mozilla's own web-ext lint
```

`lint:firefox` reports clean apart from two `UNSUPPORTED_API` warnings for `sidePanel` — that's
the Chrome branch of the feature detection, which the linter reads statically and Firefox never
executes.

### tools/convert-images.js

The server normalises images automatically, so this isn't needed at runtime. It's for when you
have files or URLs in hand and want plain JPEGs:

```bash
node tools/convert-images.js ./downloads --out ./converted
node tools/convert-images.js "https://assets-jiocdn.ajio.com/…/product.jpg"
```

Accepts files, directories, or URLs; converts AVIF/HEIC/WebP/TIFF to JPEG or PNG, downscales
past `--max`, and flattens transparency onto white.

## What garment input does YouCam render best from?

Perfect Corp documents requirements for the *person* photo and says nothing specific about the
garment reference, and third-party advice ("flat-lay and ghost mannequin both work well") is not
evidence about this engine. So it was measured: `server/tools/stress-inputs.js` builds ten
variants of one garment, renders each on the same person, and grades the outputs against the
original listing photo for garment fidelity, anatomy and realism.

Two garments, twenty renders. The result was consistent and not the expected one:

| Input variant | Tracksuit | Zip jacket |
|---|---|---|
| Original listing photo, untouched | **13/15** | 12/15 |
| Padded onto a plain background (white / black / grey) | 11–12 | **13** |
| Cropped tighter on the garment | 13 | 10 |
| Rebuilt as a flat-lay or ghost mannequin (image model) | 9–12 | 11–12 |

**Rebuilding the garment with an image model never won, and sometimes destroyed the product.**
Asked to produce a clean flat-lay of a *tracksuit*, the image model returned the jacket alone —
silently dropping the trousers — and YouCam then invented grey leggings to fill the gap. That is
precisely the hallucinated output the clean-up was meant to prevent.

The non-generative variants land within a point or two of the original, which is inside the
grader's noise. Nothing beat simply sending the retailer's own photo.

So there is no preprocessing in the default path. The experiment is kept as
`GARMENT_PREP=1`, which routes garments through `src/prep.js` (rebuild, then a fidelity check
that discards anything that drifted from the source), for anyone who wants to re-run the
comparison on their own catalogue.

The levers that *did* measurably improve output remain the ones already in place: the correct
`garment_category`, and a clear full-body person photo.

## Verified against the live APIs

The YouCam cloth contract used here was confirmed against the running service, not just read
from the docs:

- Custom garments go in as **`ref_file_id`** (a `file_id` from `POST /s2s/v2.0/file/cloth`);
  `template_id` is the alternative for YouCam's own predefined styles.
- `garment_category` accepts exactly `auto`, `upper_body`, `lower_body`, `full_body`, `shoes`.
  "Outerwear" appears in Perfect Corp's marketing copy but the API rejects it. An unknown
  category fails with `"ref_file_url is required"`, which sends you debugging the upload code
  for no reason — so `youcam.js` validates the value locally before the call.
- There is **no text prompt parameter**. Output quality is governed by the category, the
  `change_shoes` flag, and input image quality — not by prompt wording.
- Inputs must be jpg/png, under 10MB, long side at most 4096px — enforced in `youcam.js`.
- Responses are wrapped as `{status, data:{…}}`. Note the envelope's own numeric `status: 200`
  is *not* the task state — polling must read `data.task_status` (`running` / `success` /
  `error`) and the result lands in `data.result_image_url`.
- End-to-end timing on a real listing: ~2s screening + ~11s render ≈ 13s total.

## Supported sites

All retailer-specific knowledge lives in one file, `extension/shared/sites.js`. Adding a site means
adding one entry: how to find cards, where the image is, and how to upgrade the thumbnail.

| Site | Cards located by | Thumbnail → try-on resolution | Verified |
|---|---|---|---|
| Myntra | `li.product-base` | path transform → `w_1080` | ✅ end-to-end |
| AJIO | `.rilrtl-products-list__item` | single master (473×593), AVIF → JPEG | ✅ end-to-end |
| Nykaa Fashion | image → `<a>` → parent | ImageKit `tr=w-256` → `tr=w-1200` | ✅ end-to-end |
| Flipkart | image → `a[href*="/p/"]` → parent | `/image/612/612/` → `/image/1200/1200/` | ✅ end-to-end |
| Amazon | `[data-component-type="s-search-result"]` | `._AC_UL320_.` → `._AC_UL1200_.` | ✅ end-to-end |
| SNITCH | `a[href*="/buy"]` → parent | Shopify `width=` (already 800×1200) | ◐ adapter only |
| Bewakoof | `section.product-card` | `/t640/` → `/t1080/` | ◐ adapter only |
| Max Fashion | `.product` | Cloudflare `/cdn-cgi/image/w=1080` | ◐ adapter only |
| Libas | `.grid-product__content` | Shopify `width=1200` | ◐ adapter only |
| Tata CLiQ | `a.ProductModule__base` | single asset | ⚠️ grid only |
| Pinterest | `pin-closeup-image`, pin anchors | `/736x/` → `/originals/` | ✅ pin page + render |

✅ = a real garment rendered through the whole pipeline. ◐ = selectors, titles and image
URLs confirmed against the live site, but no try-on render was run.

### It works site-wide, not per category

There is no gender or category logic anywhere: the manifest matches every page on each domain,
adapters find cards structurally, and the classifier only ever emits upper/lower/full-body/shoes.
Verified on Myntra womenswear (50/50 cards on women's dresses) and a Nykaa dress, which
classified `full_body`.

Myntra also works on **product pages**, not just listings — those have no grid at all, so the
adapter falls back to the gallery, which paints as `background-image` rather than `<img>`.
Other retailers' product pages are not covered yet; their adapters are listing-grid only.

Amazon is the one site whose product title comes from `img.alt` rather than the URL slug — its
links are `sspa` click-tracking URLs with nothing readable in them.

**Tata CLiQ is the weak spot.** Its tiles, brand and name are verified against the live grid,
but its listing is fully client-rendered (the server returns a shell with no product data) and
its image component never mounted in the environment this was built in. The adapter therefore
tries both a real `<img>` and a CSS `background-image`. It needs one check in a normal browser.

Two rules came out of inspecting these live, and both shaped the adapters:

- **Never depend on a build-hashed class name.** Nykaa Fashion (`css-384pms`) and Flipkart
  (`MZeksS`) generate class names at build time, so they change on every deploy. Those two
  locate cards structurally instead — outward from the product image or product link.
- **Prefer the URL slug for the product title.** Every one of these retailers encodes the
  product name in its href (`/tripr-solid-men-round-neck-multicolor-t-shirt/p/itm…`), which
  survives redesigns that break selectors. That matters because the title is what lets the
  classifier tell a two-piece tracksuit from a jacket.

Match images by the *product* CDN, not just the brand name — matching `nykaa` anywhere in a
src picked up the site logo as a phantom product card.

### Retailer CDNs don't serve what their URLs promise

AJIO's product images end in `.jpg` and are served as `image/avif` — a format both YouCam and
OpenAI reject. Content negotiation doesn't help; the CDN returns AVIF whatever `Accept` header
you send. So every garment image is downloaded once and pushed through `server/src/image.js`,
which transcodes anything that isn't JPEG/PNG, resizes past 4096px, recompresses past 10MB,
and flattens alpha onto white (transparent cut-outs otherwise become black boxes in JPEG).

That change also removed a structural weakness: screening previously passed the *retailer URL*
to OpenAI, so it depended on OpenAI being able to fetch each CDN. It now sends the normalised
bytes, so the only thing that must reach a retailer is this server.

## Notes on the page integration

Two Myntra behaviours shaped `content.js`, both verified against the live site:

- **Images are lazy-loaded.** On a fresh page only ~11 of 50 cards have a real `<img>`; the
  rest hold a `div.lazyload-placeholder`, and the URL isn't in page state either. So the
  button attaches to the *card*, and the image URL is resolved at click time — nudging the
  card into view if needed, which populates it in ~250ms.
- **Grid thumbnails are 210px wide**, far too small for try-on. The Myntra CDN takes its
  transform as a path segment before `/assets/images/`, so swapping that segment yields a
  full-resolution source.

Results are paginated rather than infinite-scroll, but a `MutationObserver` still drives
injection because Myntra is a React SPA and swaps the grid in place on page change.

## Privacy

Your photo goes to your own local server and on to YouCam for rendering. Nothing else
touches it, and it isn't stored server-side — only the YouCam `file_id` is kept, in
`browser.storage.local`.
