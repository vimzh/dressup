/**
 * Side panel: photo setup and the current fit on one tab, the saved-looks
 * library on the other.
 *
 * Collections and looks live on the local server rather than in extension
 * storage, because YouCam's result URLs expire after two hours — a saved link
 * would be a dead image by the next day, so the render itself has to be kept.
 * The cost is that the library needs the server running; that's stated plainly
 * rather than left to render as broken thumbnails.
 */

const API = 'http://localhost:3000';

const $ = (id) => document.getElementById(id);

/* Lucide (ISC), inlined as paths — no icon font or network fetch in a panel. */
const ICONS = {
  'image-plus': '<path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  sparkle: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
};

const icon = (name, size = 14) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/** Expands every <span data-icon="…"> placeholder in a subtree. */
function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 14);
  });
}
paintIcons();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const setStatus = (el, text, kind = '') => {
  el.textContent = text;
  el.className = `status ${kind}`;
};

/* ------------------------------------------------------------------- tabs */

const panes = { Try: [$('tabTry'), $('paneTry')], Saved: [$('tabSaved'), $('paneSaved')] };
let lastTab = 'Try';

function showTab(which) {
  lastTab = which;
  for (const [name, [tab, pane]] of Object.entries(panes)) {
    const on = name === which;
    tab.setAttribute('aria-selected', String(on));
    pane.hidden = !on;
  }
  $('paneSettings').hidden = true;
  document.querySelector('.tabs-wrap').hidden = false;
  if (which === 'Saved') loadLibrary();
}

/*
 * The photo is set once and rarely changed, so it lives behind the header
 * button rather than occupying the top of the panel on every visit. Settings
 * takes over the whole body — the tab strip would be meaningless there.
 */
function showSettings() {
  for (const [, pane] of Object.values(panes)) pane.hidden = true;
  $('paneSettings').hidden = false;
  document.querySelector('.tabs-wrap').hidden = true;
}

$('tabTry').addEventListener('click', () => showTab('Try'));
$('tabSaved').addEventListener('click', () => showTab('Saved'));
$('goSettings').addEventListener('click', showSettings);
$('openSettings').addEventListener('click', showSettings);
$('backFromSettings').addEventListener('click', () => showTab(lastTab));

/* ------------------------------------------------------------------ photo */

function showPhoto(dataUrl) {
  $('preview').src = dataUrl;
  $('preview').hidden = false;
  $('ph').hidden = true;
  $('replace').hidden = false;
}

/**
 * First run shows the welcome card and nothing else; once a photo exists the
 * card gives way to a quiet link, since changing it is rare.
 */
function reflectPhotoState(hasPhoto) {
  $('needPhoto').hidden = hasPhoto;
  $('photoLinkRow').hidden = !hasPhoto;
}

chrome.storage.local.get(['personFileId', 'personPreview']).then(({ personFileId, personPreview }) => {
  if (personPreview) showPhoto(personPreview);
  if (personFileId) setStatus($('photoStatus'), 'Photo ready.', 'ok');
  reflectPhotoState(Boolean(personFileId));
});

$('replace').addEventListener('click', () => $('file').click());

$('file').addEventListener('change', async () => {
  const file = $('file').files?.[0];
  if (!file) return;

  const dataUrl = await new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(file);
  });
  showPhoto(dataUrl);

  setStatus($('photoStatus'), 'Uploading…');
  $('replace').disabled = true;

  try {
    const form = new FormData();
    form.append('photo', file);
    const res = await fetch(`${API}/api/person`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (HTTP ${res.status}).`);

    await chrome.storage.local.set({ personFileId: data.personFileId, personPreview: dataUrl });
    reflectPhotoState(true);

    // Accepted, but a half-body crop renders fine for tops and badly for trousers.
    if (data.check?.advice && data.check.framing !== 'full_body') {
      setStatus($('photoStatus'), `Ready. Tip: ${data.check.advice}`, 'warn');
    } else {
      setStatus($('photoStatus'), 'Photo ready.', 'ok');
    }
  } catch (err) {
    setStatus($('photoStatus'), err instanceof TypeError ? 'Can’t reach the Zdress server.' : err.message, 'err');
  } finally {
    $('replace').disabled = false;
  }
});

/* ------------------------------------------------------------ current fit */

let lastSelection = [];

function renderFit(selection = []) {
  lastSelection = selection;
  const has = selection.length > 0;
  $('fitEmpty').hidden = has;
  $('fitBody').hidden = !has;
  $('selCount').hidden = !has;
  $('selCount').textContent = selection.length;
  $('strip').innerHTML = selection.map((s) => `<img src="${esc(s.imageUrl)}" alt="" title="${esc(s.title)}">`).join('');
  $('tryfitLabel').textContent = `Try this fit (${selection.length})`;
}

chrome.storage.local.get('selection').then(({ selection = [] }) => renderFit(selection));
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.selection) renderFit(c.selection.newValue || []);
});

$('clearFit').addEventListener('click', () => chrome.storage.local.set({ selection: [] }));

/*
 * The fit is rendered here rather than on the page. A side panel keeps focus
 * when the user clicks elsewhere — unlike a popup, which was the original
 * reason this lived in a page overlay.
 */
let fitPayload = null;

function setFitBusy(busy, label = '') {
  $('tryfit').disabled = busy;
  $('tryfitLabel').textContent = busy ? label : `Try this fit (${lastSelection.length})`;
}

$('tryfit').addEventListener('click', async () => {
  const { personFileId, selection: items = [] } = await chrome.storage.local.get(['personFileId', 'selection']);
  if (!personFileId) return setStatus($('fitStatus'), 'Add your photo first — open settings above.', 'err');
  if (!items.length) return setStatus($('fitStatus'), 'Tick a few items first.', 'err');

  $('fitResult').hidden = true;
  setStatus($('fitStatus'), '', '');
  setFitBusy(true, 'Rendering…');

  // Each piece is a separate render, so keep the wait honest.
  const started = Date.now();
  const timer = setInterval(() => {
    const secs = Math.floor((Date.now() - started) / 1000);
    $('tryfitLabel').textContent = `Rendering… ${secs}s`;
  }, 500);

  try {
    const res = await chrome.runtime.sendMessage({ type: 'TRY_OUTFIT', items });
    if (!res?.ok) {
      setStatus($('fitStatus'), res?.error || 'Fit render failed.', 'err');
      return;
    }
    showFitResult(res);
  } finally {
    clearInterval(timer);
    setFitBusy(false);
  }
});

/* Picked up when a retailer's CSP blocked the render from showing on the page. */
chrome.storage.local.get('lastRender').then(({ lastRender }) => {
  if (!lastRender) return;
  showFitResult({
    resultUrl: lastRender.resultUrl,
    applied: [{ title: lastRender.payload.title, description: lastRender.payload.title, category: lastRender.payload.category }],
  });
  fitPayload = { ...lastRender.payload, resultUrl: lastRender.resultUrl };
  setStatus($('fitStatus'), 'Rendered — that site blocked it from showing in the grid.', '');
  chrome.storage.local.remove('lastRender');
});

function showFitResult(res) {
  $('fitImage').src = res.resultUrl;
  $('fitPills').innerHTML = (res.applied || [])
    .map((a) => `<span class="pill">${esc(a.description || a.title)}</span>`)
    .join('');

  const notes = [
    ...(res.skipped || []).map((x) => `Skipped ${esc(x.title)} — ${esc(x.why)}.`),
    ...(res.rejected || []).map((x) => `Couldn’t use ${esc(x.title)} — ${esc(x.reason)}`),
  ];
  $('fitNotes').hidden = notes.length === 0;
  $('fitNotes').innerHTML = notes.join('<br>');

  // Only the pieces that actually made it into the render — a conflicting or
  // rejected pick shouldn't leave a link on the saved look.
  const appliedTitles = new Set((res.applied || []).map((a) => a.title));
  fitPayload = {
    resultUrl: res.resultUrl,
    title: (res.applied || []).map((a) => a.title).join(' + '),
    site: [...new Set(lastSelection.map((i) => i.site).filter(Boolean))].join(', ') || 'Multiple',
    category: (res.applied || []).map((a) => a.category).join('+'),
    kind: 'outfit',
    pieces: (res.applied || []).map((a) => a.title),
    products: lastSelection
      .filter((i) => appliedTitles.has(i.title))
      .map((i) => ({ title: i.title, url: i.productUrl || '', image: i.imageUrl, site: i.site })),
  };

  $('saveFit').disabled = false;
  $('saveFitLabel').textContent = 'Save look';
  $('fitResult').hidden = false;
  setStatus($('fitStatus'), '', '');
}

$('dismissFit').addEventListener('click', () => {
  $('fitResult').hidden = true;
  fitPayload = null;
});

$('saveFit').addEventListener('click', async () => {
  if (!fitPayload) return;
  $('saveFit').disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'SAVE_LOOK', payload: fitPayload });
  if (res?.ok) {
    $('saveFitLabel').textContent = 'Saved';
  } else {
    $('saveFit').disabled = false;
    setStatus($('fitStatus'), res?.error || 'Could not save that look.', 'err');
  }
});

/* ---------------------------------------------------------------- library */

let library = { collections: [], looks: [] };
let activeCollection = 'all';

async function loadLibrary() {
  try {
    const res = await fetch(`${API}/api/library`);
    library = await res.json();
    renderLibrary();
  } catch {
    $('looks').innerHTML = '';
    $('looksEmpty').hidden = false;
    $('looksEmpty').innerHTML =
      `${icon('plug', 20)}<p>Can’t reach the Zdress server, so saved looks aren’t available. Start it with <strong>npm start</strong> in <strong>server/</strong>.</p>`;
  }
}

function countIn(cid) {
  return cid === 'all'
    ? library.looks.length
    : library.looks.filter((l) => (l.collectionId || 'unsorted') === cid).length;
}

function renderLibrary() {
  const chips = [{ id: 'all', name: 'All' }, ...library.collections];
  if (library.looks.some((l) => !l.collectionId)) chips.push({ id: 'unsorted', name: 'Unsorted' });

  $('chips').innerHTML = chips
    .map(
      (c) => `<button class="chip" data-id="${esc(c.id)}" aria-pressed="${c.id === activeCollection}">
        ${esc(c.name)}<span class="n">${countIn(c.id)}</span>
      </button>`
    )
    .join('');

  const visible =
    activeCollection === 'all'
      ? library.looks
      : library.looks.filter((l) => (l.collectionId || 'unsorted') === activeCollection);

  $('lookCount').hidden = library.looks.length === 0;
  $('lookCount').textContent = library.looks.length;

  $('looksEmpty').hidden = visible.length > 0;
  if (!visible.length && library.looks.length) {
    $('looksEmpty').innerHTML = `${icon('bookmark', 20)}<p>Nothing in this collection yet.</p>`;
  }

  $('looks').innerHTML = visible
    .map((l) => {
      // Links back to the listings, so a look saved weeks ago is still shoppable.
      const shop = (l.products || []).filter((p) => p.url);
      const shopRow = shop.length
        ? `<div class="shop">${shop
            .map(
              (p) => `<a class="shop-item" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="${esc(p.title)}">
                ${p.thumb ? `<img src="${API}${esc(p.thumb)}" alt="" loading="lazy">` : `<span class="shop-ph">${icon('shirt', 12)}</span>`}
                <span class="shop-go">${icon('external', 10)}</span>
              </a>`
            )
            .join('')}</div>`
        : '';

      return `<div class="look" data-id="${esc(l.id)}">
        <img src="${API}${esc(l.imageUrl)}" alt="${esc(l.title)}" loading="lazy">
        ${l.kind === 'outfit' ? '<span class="kind">Fit</span>' : ''}
        <button class="del" title="Delete look" aria-label="Delete look">${icon('trash', 13)}</button>
        <div class="cap">
          <b>${esc(l.title || 'Untitled look')}</b>
          <span>${esc(l.site || '')}${l.site && l.category ? ' · ' : ''}${esc((l.category || '').replace('_', ' '))}</span>
          ${shopRow}
        </div>
      </div>`;
    })
    .join('');
}

$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  activeCollection = chip.dataset.id;
  renderLibrary();
});

$('addCollection').addEventListener('click', async () => {
  const name = $('newCollection').value.trim();
  if (!name) return;
  await fetch(`${API}/api/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  $('newCollection').value = '';
  loadLibrary();
});

$('newCollection').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('addCollection').click();
});

$('looks').addEventListener('click', async (e) => {
  const del = e.target.closest('.del');
  if (!del) return;
  const id = del.closest('.look').dataset.id;
  await fetch(`${API}/api/looks/${id}`, { method: 'DELETE' });
  loadLibrary();
});

// A save can happen while the panel is open on the other tab.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'LOOK_SAVED' && !$('paneSaved').hidden) loadLibrary();
});
