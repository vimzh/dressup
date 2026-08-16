/**
 * Turns the retailer's own grid into the try-on surface.
 *
 * Clicking "Try this look" replaces that card's product photo with the render,
 * in place. No modal, no context switch — the grid becomes a grid of you, and
 * you keep scrolling. Each swapped card carries a revert toggle and a save
 * button; outfits are assembled and shown in the side panel instead.
 *
 * All retailer-specific knowledge lives in sites.js. Two page behaviours drive
 * the design here:
 *
 *   - Product images are lazy-loaded. On Myntra only ~11 of 50 cards have a real
 *     <img> on first paint, and the URL isn't in page state either, so the image
 *     is resolved at click time rather than at injection time.
 *   - Grids re-render constantly (infinite scroll, virtualised lists, SPA
 *     navigation). React will happily throw away a node we mutated, so renders
 *     are remembered by product image URL and re-applied on every pass rather
 *     than being written into the retailer's own <img>.
 */

(() => {
  'use strict';

  const site = window.ZdressSites?.siteFor();
  if (!site) return; // not a supported retailer

  const MARK = 'data-zdress';

  /** productImageUrl -> { resultUrl, payload }. Survives grid re-renders. */
  const renders = new Map();

  /*
   * Adapters that scan for "any non-icon <img>" (Tata CLiQ) would otherwise pick
   * up the render we just mounted and treat it as the product photo, corrupting
   * the URL the card is keyed by.
   */
  function productImage(card) {
    const el = site.image(card);
    return el && typeof el.closest === 'function' && el.closest('.zdress-render') ? null : el;
  }

  function productInfo(card) {
    const img = productImage(card);
    // Prefer the retailer's own brand/name markup, fall back to the URL slug —
    // several of these sites use build-hashed class names that break on deploy.
    const title = site.title(card) || window.ZdressSites.titleFromSlug(site.link(card));
    return { imageUrl: img?.src ? site.highRes(img.src) : null, title };
  }

  /**
   * Cards outside the viewport render a placeholder instead of an <img>, and the
   * URL isn't exposed anywhere else in the DOM — it can only be read once the
   * lazy-loader has swapped the real image in. Nudging the card into view
   * triggers that within ~250ms.
   */
  function resolveImageUrl(card, { timeoutMs = 3000 } = {}) {
    const existing = productImage(card);
    if (existing?.src) return Promise.resolve(site.highRes(existing.src));

    card.scrollIntoView({ block: 'center', behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));

    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const img = productImage(card);
        if (img?.src) return resolve(site.highRes(img.src));
        if (Date.now() > deadline) return resolve(null);
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  // ------------------------------------------------------------------ icons

  // Lucide (ISC), inlined as paths — a content script can't pull an icon font
  // or sprite onto a retailer page without fighting their CSP.
  const ICONS = {
    shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };

  const icon = (name, size = 14) =>
    `<svg class="zdress-i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  /**
   * Retailers hand out root-relative hrefs ("men-tshirts/brand/x/123/buy").
   * Resolving those against location.href breaks on product pages, whose path
   * has extra segments, so anything without a leading slash gets one.
   */
  function absUrl(href) {
    if (!href) return '';
    try {
      if (/^https?:/i.test(href)) return href;
      return new URL(href.startsWith('/') ? href : `/${href}`, location.origin).href;
    } catch {
      return '';
    }
  }

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ toast

  /*
   * Errors used to open a modal. That is far too heavy for "you haven't added a
   * photo yet", so problems now surface as a dismissible toast and the grid
   * stays where it was.
   */
  let toastEl;
  let toastTimer;

  function toast(message, { hint = '', duration = 6000 } = {}) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'zdress-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = `
      <div class="zdress-toast-body">
        <p>${esc(message)}</p>
        ${hint ? `<p class="zdress-toast-hint">${hint}</p>` : ''}
      </div>
      <button class="zdress-toast-x" aria-label="Dismiss">${icon('x', 13)}</button>`;
    toastEl.querySelector('.zdress-toast-x').addEventListener('click', hideToast);
    toastEl.classList.add('is-open');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, duration);
  }

  const hideToast = () => toastEl?.classList.remove('is-open');

  // ------------------------------------------------------------- card state

  /** Shimmer sweep over the card's image while its render is in flight. */
  function startShimmer(card) {
    const box = site.imageBox(card) || card;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    if (box.querySelector('.zdress-shimmer')) return;

    const veil = document.createElement('div');
    veil.className = 'zdress-shimmer';
    veil.innerHTML = '<span class="zdress-shimmer-chip"><i class="zdress-shimmer-dot"></i>Trying on…</span>';
    box.appendChild(veil);

    card.classList.add('zdress-busy');
    card.querySelector('.zdress-btn')?.setAttribute('disabled', 'true');
  }

  function stopShimmer(card) {
    card.querySelector('.zdress-shimmer')?.remove();
    card.classList.remove('zdress-busy');
    card.querySelector('.zdress-btn')?.removeAttribute('disabled');
  }

  /**
   * Paints the render over the card's product photo.
   *
   * A layer rather than a write to the retailer's own <img> src: these grids are
   * React-rendered and would overwrite the src on the next update, and this way
   * reverting is just removing a node.
   */
  function mountRender(card, { resultUrl, payload }) {
    const box = site.imageBox(card) || card;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    box.querySelector('.zdress-render')?.remove();

    const layer = document.createElement('div');
    layer.className = 'zdress-render';
    layer.innerHTML = `
      <img class="zdress-render-img" src="${esc(resultUrl)}" alt="You wearing ${esc(payload.title)}">
      <span class="zdress-onyou">${icon('check', 11)}On you</span>
      <div class="zdress-render-actions">
        <button class="zdress-act" data-act="save" title="Save look" aria-label="Save look">${icon('bookmark', 13)}</button>
        <button class="zdress-act" data-act="revert" title="Show original product" aria-label="Show original product">${icon('undo', 13)}</button>
      </div>`;

    layer.addEventListener('click', (e) => {
      const act = e.target.closest('.zdress-act')?.dataset.act;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      if (act === 'revert') revertRender(card, payload.garmentImageUrl);
      if (act === 'save') saveRender(e.target.closest('.zdress-act'), payload, resultUrl);
    });

    /*
     * Some retailers (Max Fashion) ship `img-src 'self'`, which blocks the render
     * outright and would otherwise leave a blank card with no explanation. Catch
     * the load failure and hand the result to the side panel instead.
     */
    layer.querySelector('.zdress-render-img').addEventListener('error', () => {
      layer.remove();
      renders.delete(payload.garmentImageUrl);
      chrome.storage.local.set({ lastRender: { resultUrl, payload, at: Date.now() } }).catch(() => {});
      toast('This site blocks outside images, so the render can’t show here.', {
        hint: 'Open Zdress from your toolbar — it’s waiting on the Try on tab.',
      });
    });

    box.appendChild(layer);
  }

  function revertRender(card, productUrl) {
    renders.delete(productUrl);
    card.querySelector('.zdress-render')?.remove();
  }

  async function saveRender(btn, payload, resultUrl) {
    btn.disabled = true;
    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_LOOK',
      payload: { ...payload, resultUrl },
    });
    if (res?.ok) {
      btn.classList.add('is-done');
      btn.innerHTML = icon('check', 13);
      btn.title = 'Saved';
    } else {
      btn.disabled = false;
      toast(res?.error || 'Could not save that look.');
    }
  }

  // ---------------------------------------------------------------- actions

  async function handleClick(card) {
    if (card.classList.contains('zdress-busy')) return;

    const info = productInfo(card);
    startShimmer(card);

    try {
      const imageUrl = info.imageUrl || (await resolveImageUrl(card));
      if (!imageUrl) {
        toast('That product image didn’t load. Scroll it into view and try again.');
        return;
      }

      let res;
      try {
        res = await chrome.runtime.sendMessage({
          type: 'TRY_ON',
          garmentImageUrl: imageUrl,
          productTitle: info.title,
          // Whole-look sites (Pinterest) apply everything YouCam can swap rather
          // than the single slot a shop listing implies.
          mode: site.mode || 'single',
        });
      } catch {
        // Reloading the extension invalidates this context mid-request.
        toast('Zdress was reloaded — refresh the page and try again.');
        return;
      }

      if (!res?.ok) {
        toast(res?.error || 'Try-on failed.', {
          hint:
            res?.code === 'NO_PERSON'
              ? 'Open Zdress from your toolbar to add your photo.'
              : res?.code === 'NO_SERVER'
              ? 'Start it with <code>npm start</code> in <code>server/</code>.'
              : '',
        });
        return;
      }

      const payload = {
        title: info.title,
        site: site.label,
        category: res.garment?.category || '',
        kind: 'single',
        productUrl: absUrl(site.link(card)),
        garmentImageUrl: imageUrl,
        // Kept so a saved look stays shoppable weeks later, once the render
        // itself is just a picture and the listing is what you actually want.
        products: [{ title: info.title, url: absUrl(site.link(card)), image: imageUrl, site: site.label }],
      };
      renders.set(imageUrl, { resultUrl: res.resultUrl, payload });
      mountRender(card, { resultUrl: res.resultUrl, payload });
    } finally {
      stopShimmer(card);
    }
  }

  // ---------------------------------------------------------------- ticking

  /*
   * Ticking builds an outfit across cards — and across retailers, since the
   * selection lives in extension storage rather than on the page. Items are
   * keyed by image URL so a tick survives the grid re-rendering underneath it.
   */
  const MAX_ITEMS = 4;
  let selection = [];

  const isSelected = (url) => selection.some((s) => s.imageUrl === url);

  async function loadSelection() {
    ({ selection = [] } = await chrome.storage.local.get('selection'));
    refreshCards();
  }

  async function toggleSelect(card) {
    const url = productInfo(card).imageUrl || (await resolveImageUrl(card));
    if (!url) return;

    if (isSelected(url)) {
      selection = selection.filter((s) => s.imageUrl !== url);
    } else {
      if (selection.length >= MAX_ITEMS) {
        flashTick(card, `Up to ${MAX_ITEMS} pieces`);
        return;
      }
      const item = {
        imageUrl: url,
        title: productInfo(card).title,
        site: site.label,
        productUrl: absUrl(site.link(card)),
      };
      selection = [...selection, item];
      await chrome.storage.local.set({ selection });
      refreshCards();
      labelSlot(item, card); // fills in the category, then flags any clash
      return;
    }
    await chrome.storage.local.set({ selection });
    refreshCards();
  }

  /**
   * Screening is a round trip, so the tick lands immediately and the slot is
   * filled in after. Two pieces competing for the same slot is the common
   * mistake — picking two pairs of jeans — and it is worth saying so now rather
   * than after a minute of rendering.
   */
  async function labelSlot(item, card) {
    const res = await chrome.runtime
      .sendMessage({ type: 'CLASSIFY', garmentImageUrl: item.imageUrl, productTitle: item.title })
      .catch(() => null);
    if (!res?.ok) return;

    const { selection: current = [] } = await chrome.storage.local.get('selection');
    const idx = current.findIndex((s) => s.imageUrl === item.imageUrl);
    if (idx === -1) return; // unticked while we were asking

    current[idx] = { ...current[idx], category: res.category, description: res.description };

    const clash = current.find(
      (s, i) => i !== idx && s.category && s.category === res.category
    );
    await chrome.storage.local.set({ selection: current });

    if (clash) {
      toast(`You already picked a ${slotName(res.category)} — “${clash.title}”.`, {
        hint: 'Only the newest one will be worn. Untick one in the Zdress panel.',
      });
      flashTick(card, 'Same slot as another pick');
    }
  }

  const slotName = (c) =>
    ({ upper_body: 'top', lower_body: 'bottom', full_body: 'full-body piece', shoes: 'pair of shoes' }[c] || 'piece');

  function flashTick(card, msg) {
    const tick = card.querySelector('.zdress-tick');
    if (!tick) return;
    tick.classList.add('is-blocked');
    tick.title = msg;
    setTimeout(() => tick.classList.remove('is-blocked'), 600);
  }

  /** Re-applies tick state and re-mounts renders the grid may have discarded. */
  function refreshCards() {
    document.querySelectorAll('.zdress-card').forEach((card) => {
      const raw = productImage(card)?.src;
      const url = raw ? site.highRes(raw) : null;

      const on = url ? isSelected(url) : false;
      card.classList.toggle('zdress-selected', on);
      const tick = card.querySelector('.zdress-tick');
      if (tick) {
        tick.classList.toggle('is-on', on);
        tick.setAttribute('aria-pressed', String(on));
        tick.title = on ? 'Remove from fit' : 'Add to fit';
      }

      const stored = url && renders.get(url);
      if (stored && !card.querySelector('.zdress-render')) mountRender(card, stored);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.selection) {
      selection = changes.selection.newValue || [];
      refreshCards();
    }
  });

  // -------------------------------------------------------------- injection

  function inject(card) {
    if (card.hasAttribute(MARK)) return;
    card.setAttribute(MARK, '1');
    card.classList.add('zdress-card');

    // Cards are usually wrapped in an <a>; controls must sit above it and
    // swallow the click so we don't navigate to the product page.
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

    const tick = document.createElement('button');
    tick.className = 'zdress-tick';
    tick.type = 'button';
    tick.setAttribute('aria-pressed', 'false');
    tick.title = 'Add to fit';
    tick.innerHTML = icon('check', 13);
    tick.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSelect(card);
    });

    const btn = document.createElement('button');
    btn.className = 'zdress-btn';
    btn.type = 'button';
    btn.innerHTML = `${icon('shirt', 13)}<span>Try this look</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleClick(card);
    });

    card.appendChild(tick);
    card.appendChild(btn);
  }

  function injectAll() {
    try {
      site.cards().forEach(inject);
      refreshCards();
    } catch {
      /* a mid-render DOM swap can invalidate nodes; the next pass picks them up */
    }
  }

  // Grids keep changing — infinite scroll, virtualised lists, SPA navigation.
  // Coalesce bursts of mutations into a single pass.
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      injectAll();
    });
  });

  loadSelection();
  injectAll();
  observer.observe(document.body, { childList: true, subtree: true });
})();
