/**
 * Popup: one job — capture the user's photo, upload it once, and keep the
 * resulting YouCam file_id. Every try-on reuses that id, so the photo is
 * uploaded once per user rather than once per product.
 */

const API_BASE = 'http://localhost:3000';

const els = {
  file: document.getElementById('file'),
  preview: document.getElementById('preview'),
  placeholder: document.getElementById('placeholder'),
  replace: document.getElementById('replace'),
  status: document.getElementById('status'),
  outfit: document.getElementById('outfit'),
  strip: document.getElementById('strip'),
  count: document.getElementById('count'),
  clear: document.getElementById('clear'),
  tryfit: document.getElementById('tryfit'),
  outfitNote: document.getElementById('outfitNote'),
};

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}

function showPhoto(dataUrl) {
  els.preview.src = dataUrl;
  els.preview.hidden = false;
  els.placeholder.hidden = true;
  els.replace.hidden = false;
}

// Restore previous state so the popup shows what's already configured.
chrome.storage.local.get(['personFileId', 'personPreview']).then(({ personFileId, personPreview }) => {
  if (personPreview) showPhoto(personPreview);
  if (personFileId) setStatus('Photo ready — go try something on.', 'ok');
});

els.replace.addEventListener('click', () => els.file.click());

/* ------------------------------------------------------------------ outfit */

const SUPPORTED = /myntra\.com|ajio\.com|nykaafashion\.com|flipkart\.com|tatacliq\.com|amazon\.(in|com)/;

function renderOutfit(selection = []) {
  els.outfit.hidden = selection.length === 0;
  els.count.textContent = selection.length ? `· ${selection.length}` : '';
  els.strip.innerHTML = selection
    .map((s) => `<img src="${s.imageUrl}" alt="" title="${(s.title || '').replace(/"/g, '&quot;')}">`)
    .join('');
  els.tryfit.textContent = `Try this fit (${selection.length})`;
}

chrome.storage.local.get('selection').then(({ selection = [] }) => renderOutfit(selection));
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.selection) renderOutfit(c.selection.newValue || []);
});

els.clear.addEventListener('click', () => chrome.storage.local.set({ selection: [] }));

// The result renders as an overlay on the shopping page rather than in here:
// the popup closes the moment it loses focus, which would discard a render that
// takes half a minute.
els.tryfit.addEventListener('click', async () => {
  const { personFileId } = await chrome.storage.local.get('personFileId');
  if (!personFileId) {
    els.outfitNote.textContent = 'Add your photo first.';
    els.outfitNote.className = 'outfit-note err';
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !SUPPORTED.test(tab.url)) {
    els.outfitNote.textContent = 'Open one of the supported shopping sites, then try the fit there.';
    els.outfitNote.className = 'outfit-note err';
    return;
  }

  await chrome.tabs.sendMessage(tab.id, { type: 'RUN_OUTFIT' });
  window.close(); // hand off to the page overlay
});

els.file.addEventListener('change', async () => {
  const file = els.file.files?.[0];
  if (!file) return;

  // Show it immediately; the upload takes a moment.
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  showPhoto(dataUrl);

  setStatus('Uploading…', 'busy');
  els.replace.disabled = true;

  try {
    const form = new FormData();
    form.append('photo', file);

    const res = await fetch(`${API_BASE}/api/person`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data.error || `Upload failed (HTTP ${res.status}).`);

    await chrome.storage.local.set({ personFileId: data.personFileId, personPreview: dataUrl });

    // The photo is accepted, but it may still be worth improving — a half-body
    // crop renders fine for tops and badly for trousers, so say so up front.
    const advice = data.check?.advice;
    if (advice && data.check?.framing !== 'full_body') {
      setStatus(`Photo ready. Tip: ${advice}`, 'warn');
    } else {
      setStatus('Photo ready — go try something on.', 'ok');
    }
  } catch (err) {
    const offline = err instanceof TypeError;
    setStatus(
      offline ? 'Can’t reach the DressUp server. Start it with npm start in server/.' : err.message,
      'err'
    );
  } finally {
    els.replace.disabled = false;
  }
});
