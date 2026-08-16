/**
 * Injects a "Try this look" button onto every product card and renders the
 * try-on result in an overlay.
 *
 * All retailer-specific knowledge lives in sites.js; this file only deals with
 * the interaction. Two behaviours are common to every supported grid and drive
 * the design here:
 *
 *   - Product images are lazy-loaded. On Myntra only ~11 of 50 cards have a real
 *     <img> on first paint, and the URL isn't in page state either. So the button
 *     attaches to the card and the image URL is resolved at click time.
 *   - Grids mutate constantly (infinite scroll, virtualised lists, SPA page
 *     changes). A MutationObserver re-runs injection on any DOM change.
 */

(() => {
  'use strict';

  const site = window.ZdressSites?.siteFor();
  if (!site) return; // not a supported retailer

  const MARK = 'data-zdress';

  function productInfo(card) {
    const img = site.image(card);
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
    const existing = site.image(card);
    if (existing?.src) return Promise.resolve(site.highRes(existing.src));

    card.scrollIntoView({ block: 'center', behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));

    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const img = site.image(card);
        if (img?.src) return resolve(site.highRes(img.src));
        if (Date.now() > deadline) return resolve(null);
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  // ------------------------------------------------------------- selection

  /*
   * Ticking items builds an outfit across cards — and across retailers, since the
   * selection lives in extension storage rather than on the page. Items are keyed
   * by image URL so the tick survives the grid re-rendering underneath it.
   */
  const MAX_ITEMS = 4;
  let selection = [];

  const selKey = (url) => url;
  const isSelected = (url) => selection.some((s) => selKey(s.imageUrl) === selKey(url));

  async function loadSelection() {
    ({ selection = [] } = await chrome.storage.local.get('selection'));
    refreshTicks();
  }

  async function saveSelection() {
    await chrome.storage.local.set({ selection });
    refreshTicks();
  }

  async function toggleSelect(card) {
    let url = productInfo(card).imageUrl;
    if (!url) url = await resolveImageUrl(card);
    if (!url) return;

    const info = productInfo(card);
    if (isSelected(url)) {
      selection = selection.filter((s) => selKey(s.imageUrl) !== selKey(url));
    } else {
      if (selection.length >= MAX_ITEMS) {
        flashTick(card, `Up to ${MAX_ITEMS} pieces`);
        return;
      }
      selection = [...selection, { imageUrl: url, title: info.title, site: site.label }];
    }
    await saveSelection();
  }

  /** Re-applies selected styling; runs after any storage change or DOM pass. */
  function refreshTicks() {
    document.querySelectorAll('.zdress-card').forEach((card) => {
      const url = site.image(card)?.src;
      const on = url ? isSelected(site.highRes(url)) : false;
      card.classList.toggle('zdress-selected', on);
      const tick = card.querySelector('.zdress-tick');
      if (tick) {
        tick.classList.toggle('is-on', on);
        tick.setAttribute('aria-pressed', String(on));
        tick.title = on ? 'Remove from outfit' : 'Add to outfit';
      }
    });
  }

  function flashTick(card, msg) {
    const tick = card.querySelector('.zdress-tick');
    if (!tick) return;
    tick.classList.add('is-blocked');
    tick.title = msg;
    setTimeout(() => tick.classList.remove('is-blocked'), 600);
  }

  // Keep every open tab's ticks in sync — selection is shared across retailers.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.selection) {
      selection = changes.selection.newValue || [];
      refreshTicks();
    }
  });

  // ------------------------------------------------------------- card state

  /**
   * Marks a card as rendering with a shimmer sweep across its image.
   * The overlay can be dismissed while a render is still running, so the card
   * itself carries the progress — otherwise closing the modal loses any sign
   * that work is in flight.
   */
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

  // ---------------------------------------------------------------- overlay

  let overlay;

  function ensureOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.className = 'zdress-overlay';
    overlay.innerHTML = `
      <div class="zdress-modal" role="dialog" aria-modal="true" aria-label="Virtual try-on">
        <button class="zdress-close" aria-label="Close">${icon('x', 15)}</button>
        <div class="zdress-body"></div>
      </div>`;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('zdress-close')) closeOverlay();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeOverlay();
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function openOverlay(html) {
    const el = ensureOverlay();
    el.querySelector('.zdress-body').innerHTML = html;
    el.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function setBody(html) {
    if (overlay) overlay.querySelector('.zdress-body').innerHTML = html;
  }

  function closeOverlay() {
    overlay?.classList.remove('is-open');
    document.body.style.overflow = '';
    stopTicker();
  }

  // Try-on runs 10-30s. A static spinner reads as a hang, so show elapsed time
  // and move through honest status copy.
  let ticker;
  const STAGES = [
    [0, 'Checking the garment…'],
    [4, 'Sending it to the try-on engine…'],
    [10, 'Rendering you in this look…'],
    [25, 'Almost there — adding the finishing details…'],
  ];

  function startTicker() {
    const started = Date.now();
    stopTicker();
    ticker = setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      const stage = [...STAGES].reverse().find(([t]) => secs >= t)?.[1] ?? '';
      const stageEl = overlay?.querySelector('.zdress-stage');
      const timeEl = overlay?.querySelector('.zdress-elapsed');
      if (stageEl) stageEl.textContent = stage;
      if (timeEl) timeEl.textContent = `${secs}s`;
    }, 250);
  }

  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Lucide (ISC). Inlined as paths — a content script can't pull an icon font or
  // sprite onto a retailer page without fighting their CSP.
  const ICONS = {
    shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  };

  const icon = (name, size = 14) =>
    `<svg class="zdress-i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  function loadingView({ title, imageUrl }) {
    return `
      <div class="zdress-loading">
        <div class="zdress-thumb"><img src="${imageUrl ? esc(imageUrl) : ''}" alt=""></div>
        <div class="zdress-spinner"></div>
        <p class="zdress-stage">Checking the garment…</p>
        <p class="zdress-meta">${esc(title)} · <span class="zdress-elapsed">0s</span></p>
      </div>`;
  }

  /**
   * Save control shown under a finished render. Collections are fetched lazily
   * so the picker reflects anything created in the side panel since page load.
   */
  function saveBar(payload) {
    return `
      <div class="zdress-save" data-payload="${esc(JSON.stringify(payload))}">
        <select class="zdress-select" aria-label="Collection"><option value="">Unsorted</option></select>
        <button class="zdress-save-btn" type="button">Save look</button>
      </div>`;
  }

  function resultView({ resultUrl, garment, title, payload }) {
    return `
      <div class="zdress-result">
        <img class="zdress-result-img" src="${esc(resultUrl)}" alt="You wearing ${esc(title)}">
        <div class="zdress-caption">
          ${esc(title)}
          ${garment?.description ? `<span class="zdress-desc">${esc(garment.description)}</span>` : ''}
          ${saveBar(payload)}
        </div>
      </div>`;
  }

  /** Populates the collection picker and wires the save button. */
  async function initSaveBar() {
    const bar = overlay?.querySelector('.zdress-save');
    if (!bar) return;

    const select = bar.querySelector('.zdress-select');
    const btn = bar.querySelector('.zdress-save-btn');

    const { collections = [] } = await chrome.runtime.sendMessage({ type: 'LIST_COLLECTIONS' });
    for (const c of collections) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    }

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Saving…';
      const payload = { ...JSON.parse(bar.dataset.payload), collectionId: select.value || null };
      const res = await chrome.runtime.sendMessage({ type: 'SAVE_LOOK', payload });
      btn.textContent = res?.ok ? 'Saved ✓' : 'Save failed';
      if (!res?.ok) {
        btn.disabled = false;
        bar.insertAdjacentHTML('beforeend', `<p class="zdress-save-err">${esc(res?.error || '')}</p>`);
      }
    });
  }

  function errorView(code, message) {
    const cta =
      code === 'NO_PERSON'
        ? '<p class="zdress-hint">Click the Zdress icon in your Chrome toolbar to add your photo.</p>'
        : code === 'NO_SERVER'
        ? '<p class="zdress-hint">Start it with <code>npm start</code> in the <code>server/</code> folder.</p>'
        : '';
    const title = code === 'NOT_APPAREL' ? 'Can’t try this one on' : 'Something went wrong';
    return `
      <div class="zdress-error">
        <div class="zdress-error-icon">${icon(code === 'NOT_APPAREL' ? 'shirt' : 'alert', 22)}</div>
        <h3>${title}</h3>
        <p>${esc(message)}</p>
        ${cta}
      </div>`;
  }

  // ---------------------------------------------------------------- actions

  async function handleClick(card) {
    if (card.classList.contains('zdress-busy')) return; // already rendering

    const info = productInfo(card);
    startShimmer(card);
    openOverlay(loadingView(info));
    startTicker();

    try {
      if (!info.imageUrl) {
        info.imageUrl = await resolveImageUrl(card);
        if (!info.imageUrl) {
          setBody(errorView('NO_IMAGE', 'This product’s image didn’t load. Scroll it into view and try again.'));
          return;
        }
        const thumb = overlay?.querySelector('.zdress-thumb img');
        if (thumb) thumb.src = info.imageUrl;
      }

      const res = await chrome.runtime.sendMessage({
        type: 'TRY_ON',
        garmentImageUrl: info.imageUrl,
        productTitle: info.title,
      });

      // The modal may have been dismissed mid-render; a finished render is worth
      // re-opening rather than dropping.
      if (res?.ok) {
        openOverlay(
          resultView({
            ...res,
            title: info.title,
            payload: {
              resultUrl: res.resultUrl,
              title: info.title,
              site: site.label,
              category: res.garment?.category || '',
              kind: 'single',
              productUrl: site.link(card) || '',
            },
          })
        );
        initSaveBar();
      } else {
        openOverlay(errorView(res?.code, res?.error || 'Try-on failed.'));
      }
    } finally {
      stopTicker();
      stopShimmer(card);
    }
  }

  function outfitResultView({ resultUrl, applied, skipped, rejected }) {
    const notes = [
      ...(skipped || []).map((s) => `Skipped <strong>${esc(s.title)}</strong> — ${esc(s.why)}.`),
      ...(rejected || []).map((r) => `Couldn’t use <strong>${esc(r.title)}</strong> — ${esc(r.reason)}`),
    ];
    const payload = {
      resultUrl,
      title: applied.map((a) => a.title).join(' + '),
      site: site.label,
      category: applied.map((a) => a.category).join('+'),
      kind: 'outfit',
      pieces: applied.map((a) => a.title),
    };
    return `
      <div class="zdress-result">
        <img class="zdress-result-img" src="${esc(resultUrl)}" alt="You wearing the selected outfit">
        <div class="zdress-caption">
          <div class="zdress-applied">
            ${applied.map((a) => `<span class="zdress-pill">${esc(a.description || a.title)}</span>`).join('')}
          </div>
          ${notes.length ? `<div class="zdress-notes">${notes.join('<br>')}</div>` : ''}
          ${saveBar(payload)}
        </div>
      </div>`;
  }

  /** Runs a full outfit from the current selection. Triggered by the popup. */
  async function runOutfit() {
    const { selection: items = [] } = await chrome.storage.local.get('selection');
    if (!items.length) {
      openOverlay(errorView('NO_ITEMS', 'Tick a few items first, then try the fit.'));
      return;
    }

    openOverlay(`
      <div class="zdress-loading">
        <div class="zdress-strip">
          ${items.map((i) => `<img src="${esc(i.imageUrl)}" alt="">`).join('')}
        </div>
        <div class="zdress-spinner"></div>
        <p class="zdress-stage">Putting the outfit together…</p>
        <p class="zdress-meta">${items.length} piece${items.length > 1 ? 's' : ''} · <span class="zdress-elapsed">0s</span></p>
      </div>`);

    // Each piece is a separate render, so the wait scales with the selection.
    const started = Date.now();
    stopTicker();
    ticker = setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      const el = overlay?.querySelector('.zdress-elapsed');
      if (el) el.textContent = `${secs}s`;
      const stage = overlay?.querySelector('.zdress-stage');
      if (stage && secs > 6) stage.textContent = `Layering piece ${Math.min(items.length, Math.floor(secs / 13) + 1)} of ${items.length}…`;
    }, 250);

    try {
      const res = await chrome.runtime.sendMessage({ type: 'TRY_OUTFIT', items });
      if (res?.ok) {
        openOverlay(outfitResultView(res));
        initSaveBar();
      } else {
        openOverlay(errorView(res?.code, res?.error || 'Outfit try-on failed.'));
      }
    } finally {
      stopTicker();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'RUN_OUTFIT') runOutfit();
  });

  function inject(card) {
    if (card.hasAttribute(MARK)) return;
    card.setAttribute(MARK, '1');
    card.classList.add('zdress-card');

    // Cards are usually wrapped in an <a>; the button must sit above it and
    // swallow the click so we don't navigate to the product page.
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'zdress-btn';
    btn.type = 'button';
    btn.innerHTML = `${icon('shirt', 13)}<span>Try this look</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleClick(card);
    });

    // Tick = add to outfit. Sits beside the try-on button so one click previews
    // a single piece and the other builds a combination.
    const tick = document.createElement('button');
    tick.className = 'zdress-tick';
    tick.type = 'button';
    tick.setAttribute('aria-pressed', 'false');
    tick.title = 'Add to outfit';
    tick.innerHTML = icon('check', 13);
    tick.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSelect(card);
    });

    card.appendChild(tick);
    card.appendChild(btn);
  }

  function injectAll() {
    try {
      site.cards().forEach(inject);
      refreshTicks();
    } catch {
      /* a mid-render DOM swap can invalidate nodes; the next pass picks them up */
    }
  }

  // Grids keep changing — infinite scroll, virtualised lists, SPA navigation.
  // Coalesce bursts of mutations into a single injection pass.
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
