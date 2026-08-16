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
const SUPPORTED = /myntra\.com|ajio\.com|nykaafashion\.com|flipkart\.com|tatacliq\.com|amazon\.(in|com)|snitch\.com|bewakoof\.com|maxfashion\.in|libas\.in/;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const setStatus = (el, text, kind = '') => {
  el.textContent = text;
  el.className = `status ${kind}`;
};

/* ------------------------------------------------------------------- tabs */

const panes = { Try: [$('tabTry'), $('paneTry')], Saved: [$('tabSaved'), $('paneSaved')] };

function showTab(which) {
  for (const [name, [tab, pane]] of Object.entries(panes)) {
    const on = name === which;
    tab.setAttribute('aria-selected', String(on));
    pane.hidden = !on;
  }
  if (which === 'Saved') loadLibrary();
}

$('tabTry').addEventListener('click', () => showTab('Try'));
$('tabSaved').addEventListener('click', () => showTab('Saved'));

/* ------------------------------------------------------------------ photo */

function showPhoto(dataUrl) {
  $('preview').src = dataUrl;
  $('preview').hidden = false;
  $('ph').hidden = true;
  $('replace').hidden = false;
}

chrome.storage.local.get(['personFileId', 'personPreview']).then(({ personFileId, personPreview }) => {
  if (personPreview) showPhoto(personPreview);
  if (personFileId) setStatus($('photoStatus'), 'Photo ready.', 'ok');
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

    // Accepted, but a half-body crop renders fine for tops and badly for trousers.
    if (data.check?.advice && data.check.framing !== 'full_body') {
      setStatus($('photoStatus'), `Ready. Tip: ${data.check.advice}`, 'warn');
    } else {
      setStatus($('photoStatus'), 'Photo ready.', 'ok');
    }
  } catch (err) {
    setStatus($('photoStatus'), err instanceof TypeError ? 'Can’t reach the DressUp server.' : err.message, 'err');
  } finally {
    $('replace').disabled = false;
  }
});

/* ------------------------------------------------------------ current fit */

function renderFit(selection = []) {
  const has = selection.length > 0;
  $('fitEmpty').hidden = has;
  $('fitBody').hidden = !has;
  $('selCount').hidden = !has;
  $('selCount').textContent = selection.length;
  $('strip').innerHTML = selection.map((s) => `<img src="${esc(s.imageUrl)}" alt="" title="${esc(s.title)}">`).join('');
  $('tryfit').textContent = `Try this fit (${selection.length})`;
}

chrome.storage.local.get('selection').then(({ selection = [] }) => renderFit(selection));
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.selection) renderFit(c.selection.newValue || []);
});

$('clearFit').addEventListener('click', () => chrome.storage.local.set({ selection: [] }));

// The render is shown as an overlay on the shopping page, not in here — it can
// take a minute, and the panel is too narrow to show a full-length figure well.
$('tryfit').addEventListener('click', async () => {
  const { personFileId } = await chrome.storage.local.get('personFileId');
  if (!personFileId) return setStatus($('fitStatus'), 'Add your photo first.', 'err');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !SUPPORTED.test(tab.url)) {
    return setStatus($('fitStatus'), 'Open a supported shopping site to see the result.', 'err');
  }

  await chrome.tabs.sendMessage(tab.id, { type: 'RUN_OUTFIT' });
  setStatus($('fitStatus'), 'Rendering on the page…', '');
});

/* ---------------------------------------------------------------- library */

let library = { collections: [], looks: [] };
let activeCollection = 'all';

async function loadLibrary() {
  try {
    const res = await fetch(`${API}/api/library`);
    library = await res.json();
    $('foot').textContent = 'Renders are stored by your local DressUp server.';
    renderLibrary();
  } catch {
    $('looks').innerHTML = '';
    $('looksEmpty').hidden = false;
    $('looksEmpty').innerHTML =
      'Can’t reach the DressUp server, so your saved looks aren’t available. Start it with <strong>npm start</strong> in <strong>server/</strong>.';
    $('foot').textContent = 'Server offline — saved looks unavailable.';
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
    $('looksEmpty').textContent = 'Nothing in this collection yet.';
  }

  $('looks').innerHTML = visible
    .map(
      (l) => `<div class="look" data-id="${esc(l.id)}">
        <img src="${API}${esc(l.imageUrl)}" alt="${esc(l.title)}" loading="lazy">
        ${l.kind === 'outfit' ? '<span class="kind">Fit</span>' : ''}
        <button class="del" title="Delete">&times;</button>
        <div class="cap">
          <b>${esc(l.title || 'Untitled look')}</b>
          <span>${esc(l.site || '')}${l.site && l.category ? ' · ' : ''}${esc((l.category || '').replace('_', ' '))}</span>
        </div>
      </div>`
    )
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
