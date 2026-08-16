# Zdress — virtual try-on where you actually shop

<img src="extension/icons/icon128.png" width="72" alt="Zdress">

A Chrome extension that puts a **"Try this look"** button on every product across India's
biggest fashion sites — **Myntra, AJIO, Nykaa Fashion, Flipkart and Tata CLiQ**. Upload your
photo once; click any product and see *yourself* wearing it — without leaving the results page.

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

Each card carries two controls: **"Try this look"** on the right previews that single piece, and
a **tick** on the left adds it to an outfit. Tick a top here, trousers there, open the extension
and hit **Try this fit** — you get one image of yourself wearing the combination.

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

## Saving looks

Every finished render gets a **Save look** control with a collection picker. Saved looks
collect in a full-height **side panel** (Chrome's Side Panel API, not a popup), split into two
tabs: *Try on* for your photo and the current fit, *Saved* for the library.

Because the selection and the library are both extension-level rather than page-level, a
single collection can hold looks from Myntra, Flipkart and AJIO side by side — the point of
the feature is consolidating across stores.

**Renders are stored as files by the local server, not as links.** YouCam returns pre-signed
URLs that expire after two hours, so a saved link would be a dead image by the next day. The
trade-off is that the library needs the server running; when it isn't, the panel says so
plainly instead of rendering broken thumbnails.

Deleting a collection keeps its looks — they fall back to *Unsorted* rather than vanishing.

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
                     result overlay ◀────────────┘
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

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder

### 3. Use it

1. Click the Zdress icon and upload a photo — full body, facing forward, plain background works best.
2. Go to any Myntra listing page, e.g. [sportswear](https://www.myntra.com/sports-wear).
3. Hit **Try this look** on any product.

Rendering takes roughly 10–30 seconds.

---

## Layout

```
server/
  src/index.js            Express routes: /api/person, /api/tryon, /api/outfit
  src/youcam.js           YouCam client — upload, create task, poll
  src/garment.js          OpenAI vision pre-flight (garment + person photo)
  src/image.js            Format/size normalisation (AVIF, HEIC, oversized, alpha)
  src/library.js          Saved looks + collections (files on disk)
  tools/convert-images.js Standalone converter, for files you already have
extension/
  manifest.json    MV3
  sites.js         Per-retailer adapters — the only site-specific code
  content.js       Button + tick injection, image resolution, result overlay
  content.css      Injected styles (namespaced, !important against retailer CSS)
  background.js    Service worker — all backend calls
  sidepanel.html/js Side panel — photo, current fit, collections, saved looks
```

### tools/convert-images.js

The server normalises images automatically, so this isn't needed at runtime. It's for when you
have files or URLs in hand and want plain JPEGs:

```bash
node tools/convert-images.js ./downloads --out ./converted
node tools/convert-images.js "https://assets-jiocdn.ajio.com/…/product.jpg"
```

Accepts files, directories, or URLs; converts AVIF/HEIC/WebP/TIFF to JPEG or PNG, downscales
past `--max`, and flattens transparency onto white.

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

All retailer-specific knowledge lives in one file, `extension/sites.js`. Adding a site means
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
`chrome.storage.local`.
