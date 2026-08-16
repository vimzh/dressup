/**
 * Site adapters.
 *
 * Each supported retailer differs in three ways that matter: how product cards
 * are found, where the image lives, and how to turn a grid thumbnail into a
 * resolution worth sending to a try-on engine. Everything else in the extension
 * is site-agnostic, so adding a retailer means adding one entry here.
 *
 * Two hard-won rules shape these adapters, both from inspecting the live sites:
 *
 *  1. Never depend on a build-hashed class name. Nykaa Fashion (`css-384pms`)
 *     and Flipkart (`MZeksS`, `CIaYa1`) generate class names at build time, so
 *     they change on every deploy. For those, cards are located structurally —
 *     from the product image or the product link outward.
 *
 *  2. Prefer the URL slug for the product title. Every one of these retailers
 *     encodes the product name in its href, which survives redesigns that break
 *     selectors. The title matters because it is what lets the classifier tell a
 *     two-piece tracksuit from a jacket.
 */

(() => {
  'use strict';

/** "/buda-jeans-co-men-washed-mid-rise-baggy-jeans/p/703774493_black" -> "buda jeans co men washed mid rise baggy jeans" */
function titleFromSlug(href, { minWords = 3 } = {}) {
  if (!href) return '';
  let path;
  try {
    path = new URL(href, location.origin).pathname;
  } catch {
    return '';
  }

  const best = path
    .split('/')
    .filter(Boolean)
    // The name segment is the hyphenated one; ids and short routes ("p", "buy") are not.
    .filter((seg) => seg.includes('-') && !/^\d+$/.test(seg) && !/^(itm|mp)/i.test(seg))
    .sort((a, b) => b.length - a.length)[0];

  if (!best) return '';
  const words = best.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.split(' ').length >= minWords ? words : '';
}

const text = (root, sel) => (sel && root?.querySelector(sel)?.textContent?.trim()) || '';
const uniq = (arr) => [...new Set(arr)];

/** Reads a CSS background-image URL, for grids that paint rather than use <img>. */
function bgUrl(el) {
  const m = el && getComputedStyle(el).backgroundImage?.match(/url\(["']?(.*?)["']?\)/);
  return m?.[1] || null;
}

/**
 * Swaps the leading transform segment on a Myntra CDN URL.
 * Listing thumbs look like `/dpr_2,q_60,w_210,.../assets/images/…` while product
 * pages use `/h_720,q_90,w_540/v1/assets/images/…` — rebuilding the path from
 * `/assets/images/` would silently drop that `/v1/` and 404.
 */
function myntraHighRes(url, transform = 'q_90,w_1080,c_limit,fl_progressive') {
  try {
    const u = new URL(url, 'https://assets.myntassets.com');
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length && parts[0].includes(',')) parts[0] = transform;
    else parts.unshift(transform);
    return `https://assets.myntassets.com/${parts.join('/')}`;
  } catch {
    return url;
  }
}

const SITES = [
  {
    id: 'myntra',
    label: 'Myntra',
    match: (h) => /(^|\.)myntra\.com$/.test(h),
    // Myntra renders all 50 cards up front but lazy-loads the images, so cards
    // are listed directly and the image is resolved later, at click time.
    // Listing grids render all 50 cards up front but lazy-load the images.
    // On a product page there is no grid at all, so fall back to the gallery —
    // browsing doesn't stop at the listing, and neither should the button.
    cards: () => {
      const grid = [...document.querySelectorAll('li.product-base')];
      if (grid.length) return grid;
      const gallery = document.querySelector('.image-grid-container');
      return gallery ? [gallery] : [];
    },
    imageBox: (card) =>
      card.querySelector('.product-imageSliderContainer') || card.querySelector('.image-grid-imageContainer') || card,
    // Product pages paint the gallery as background-image rather than <img>.
    image: (card) => {
      const el = card.querySelector('img[src*="myntassets"]');
      if (el) return el;
      const bg = bgUrl(card.querySelector('.image-grid-image'));
      return bg ? { src: bg } : null;
    },
    title: (card) =>
      `${text(card, '.product-brand')} ${text(card, '.product-product')}`.trim() ||
      `${text(document, '.pdp-title')} ${text(document, '.pdp-name')}`.trim(),
    link: (card) => card.querySelector('a')?.getAttribute('href') || location.pathname,
    highRes: (url) => myntraHighRes(url),
  },

  {
    id: 'ajio',
    label: 'AJIO',
    match: (h) => /(^|\.)ajio\.com$/.test(h),
    cards: () => [...document.querySelectorAll('.rilrtl-products-list__item')],
    imageBox: (card) => card.querySelector('.imgHolder') || card.querySelector('.preview'),
    image: (card) => card.querySelector('img[src*="ajio.com"], img.rilrtl-lazy-img'),
    title: (card) => `${text(card, '.brand')} ${text(card, '.nameCls')}`.trim(),
    link: (card) => card.querySelector('a')?.getAttribute('href'),
    // AJIO serves a single master asset (~473x593); there is no size parameter.
    highRes: (url) => url,
  },

  {
    id: 'nykaafashion',
    label: 'Nykaa Fashion',
    match: (h) => /(^|\.)nykaafashion\.com$/.test(h),
    // Class names here are emotion-hashed, so walk out from the image instead:
    // image -> wrapping <a> -> the card div that also holds brand and name.
    // Match the product CDN specifically, not "nykaa" anywhere in the src —
    // the site logo lives on images-static.nykaa.com and would otherwise be
    // picked up as a phantom product card.
    cards: () =>
      uniq(
        [...document.querySelectorAll('img[src*="adn-static"]')]
          .filter((img) => !/\.svg($|\?)/i.test(img.src))
          .map((img) => img.closest('a')?.parentElement)
          .filter(Boolean)
      ),
    imageBox: (card) => card.querySelector('a'),
    image: (card) => card.querySelector('img[src*="adn-static"]'),
    title: (card) => titleFromSlug(card.querySelector('a')?.getAttribute('href')),
    link: (card) => card.querySelector('a')?.getAttribute('href'),
    // ImageKit transform: thumbnails ship as tr=w-256.
    highRes: (url) => (url.includes('tr=w-') ? url.replace(/tr=w-\d+/, 'tr=w-1200') : url),
  },

  {
    id: 'flipkart',
    label: 'Flipkart',
    match: (h) => /(^|\.)flipkart\.com$/.test(h),
    // Also hashed class names; the product link is the stable anchor.
    cards: () =>
      uniq(
        [...document.querySelectorAll('img[src*="rukminim"]')]
          .map((img) => img.closest('a[href*="/p/"]')?.parentElement)
          .filter(Boolean)
      ),
    imageBox: (card) => card.querySelector('a[href*="/p/"]'),
    image: (card) => card.querySelector('img[src*="rukminim"]'),
    title: (card) => titleFromSlug(card.querySelector('a[href*="/p/"]')?.getAttribute('href')),
    link: (card) => card.querySelector('a[href*="/p/"]')?.getAttribute('href'),
    // Size is baked into the path as /image/<w>/<h>/.
    highRes: (url) => url.replace(/\/image\/\d+\/\d+\//, '/image/1200/1200/'),
  },

  {
    id: 'snitch',
    label: 'SNITCH',
    match: (h) => /(^|\.)snitch\.(com|co\.in)$/.test(h),
    // Shopify storefront: product links all end in /buy, and the grid item is
    // the anchor's parent. Its Tailwind utility classes are too generic to key on.
    cards: () =>
      uniq([...document.querySelectorAll('a[href*="/buy"]')].map((a) => a.parentElement).filter(Boolean)),
    imageBox: (card) => card.querySelector('a'),
    image: (card) => card.querySelector('img[src*="cdn.shopify"], img[src*="snitch"]'),
    title: (card) => titleFromSlug(card.querySelector('a')?.getAttribute('href')),
    link: (card) => card.querySelector('a')?.getAttribute('href'),
    // Already served around 800x1200; Shopify honours an explicit width.
    highRes: (url) => (/[?&]width=/.test(url) ? url.replace(/([?&]width=)\d+/, '$11200') : url),
  },

  {
    id: 'bewakoof',
    label: 'Bewakoof',
    match: (h) => /(^|\.)bewakoof\.com$/.test(h),
    // styled-components hashes the rest of the class list, but `product-card` is
    // a stable hook alongside it.
    cards: () => [...document.querySelectorAll('section.product-card, .product-card')],
    imageBox: (card) => card.querySelector('figure') || card.querySelector('a'),
    image: (card) => card.querySelector('img[src*="images.bewakoof.com"]'),
    title: (card) => titleFromSlug(card.querySelector('a[href*="/p/"]')?.getAttribute('href')),
    link: (card) => card.querySelector('a[href*="/p/"]')?.getAttribute('href'),
    // Size is a path token: /t640/ -> /t1080/
    highRes: (url) => url.replace(/\/t\d+\//, '/t1080/'),
  },

  {
    id: 'maxfashion',
    label: 'Max Fashion',
    match: (h) => /(^|\.)maxfashion\.in$/.test(h),
    // Material-UI jss class names are build-generated; `product` is the stable one.
    cards: () => [...document.querySelectorAll('.MuiBox-root.product, div.product')],
    imageBox: (card) => card.querySelector('a'),
    image: (card) => card.querySelector('img[src*="landmarkshops"]'),
    title: (card) => titleFromSlug(card.querySelector('a[href*="/p/"]')?.getAttribute('href')),
    link: (card) => card.querySelector('a[href*="/p/"]')?.getAttribute('href'),
    // Cloudflare image resizing: /cdn-cgi/image/h=739,w=499,q=85,fit=cover/
    highRes: (url) => url.replace(/\/cdn-cgi\/image\/[^/]+\//, '/cdn-cgi/image/w=1080,q=90,fit=cover/'),
  },

  {
    id: 'libas',
    label: 'Libas',
    match: (h) => /(^|\.)libas\.in$/.test(h),
    cards: () => [...document.querySelectorAll('.grid-product__content')],
    imageBox: (card) => card.querySelector('.grid-product__image-mask') || card.querySelector('a'),
    image: (card) => card.querySelector('img[src*="/cdn/shop/"], img[src*="cdn.shopify"]'),
    title: (card) => titleFromSlug(card.querySelector('a[href*="/products/"]')?.getAttribute('href')),
    link: (card) => card.querySelector('a[href*="/products/"]')?.getAttribute('href'),
    highRes: (url) => (/[?&]width=/.test(url) ? url.replace(/([?&]width=)\d+/, '$11200') : url),
  },

  {
    id: 'amazon',
    label: 'Amazon',
    match: (h) => /(^|\.)amazon\.(in|com)$/.test(h),
    // `data-component-type` is a stable contract on Amazon's search results and
    // survives their frequent markup churn, unlike the class names around it.
    cards: () => [...document.querySelectorAll('[data-component-type="s-search-result"]')],
    imageBox: (card) => card.querySelector('.s-product-image-container, [data-cy="image-container"]'),
    image: (card) => card.querySelector('img.s-image'),
    // Amazon's product links are sspa click-tracking URLs with no readable slug,
    // but the image alt text carries the full listing title.
    title: (card) =>
      (card.querySelector('img.s-image')?.getAttribute('alt') || '')
        .replace(/^Sponsored Ad\s*-\s*/i, '')
        .trim(),
    link: (card) => card.querySelector('a.a-link-normal')?.getAttribute('href'),
    // Size lives in a filename token: ._AC_UL320_.jpg -> ._AC_UL1200_.jpg
    highRes: (url) => url.replace(/\._[A-Z0-9_,]*_\.(jpg|jpeg|png)/i, '._AC_UL1200_.$1'),
  },

  {
    id: 'tatacliq',
    label: 'Tata CLiQ',
    match: (h) => /(^|\.)tatacliq\.com$/.test(h),
    cards: () => [...document.querySelectorAll('a.ProductModule__base')],
    imageBox: (card) => card.querySelector('.ProductModule__imageHolder'),
    /*
     * Tata CLiQ is the least pinned-down of these adapters. Its listing is fully
     * client-rendered (the server returns a shell with no product data) and its
     * image component never mounted in the environment this was built in, so the
     * two strategies below are belt-and-braces:
     *   1. a real <img>, excluding the rating-star and other chrome icons;
     *   2. a CSS background-image, which is how its Image__base component paints
     *      in some variants.
     * Only `src` is read downstream, so returning a plain object is enough.
     */
    image: (card) => {
      const isIcon = (u) => !u || /\.svg($|\?)/i.test(u) || /general\/components\/img|images\/icons/i.test(u);

      const el = [...card.querySelectorAll('img')].find((i) => !isIcon(i.src));
      if (el) return el;

      for (const node of card.querySelectorAll('.Image__base, .PlpImageGallery__imagebox, [style*="background-image"]')) {
        const url = getComputedStyle(node).backgroundImage?.match(/url\(["']?(.*?)["']?\)/)?.[1];
        if (url && !isIcon(url)) return { src: url };
      }
      return null;
    },
    title: (card) =>
      `${text(card, '.ProductDescription__boldText')} ${text(card, '.ProductDescription__description')}`.trim() ||
      titleFromSlug(card.getAttribute('href')),
    link: (card) => card.getAttribute('href'),
    highRes: (url) => url,
  },
];

function siteFor(hostname = location.hostname) {
  return SITES.find((s) => s.match(hostname)) || null;
}

  // Content scripts are classic scripts sharing one isolated-world global scope,
  // so this file publishes its API rather than using ES module exports.
  window.ZdressSites = { SITES, siteFor, titleFromSlug };
})();
