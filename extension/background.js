/**
 * Service worker. All network calls to the backend happen here rather than in
 * the content script: the worker has host_permissions for localhost and isn't
 * subject to Myntra's page CSP.
 */

const API_BASE = 'http://localhost:3000';

async function tryOn({ garmentImageUrl, productTitle }) {
  const { personFileId } = await chrome.storage.local.get('personFileId');
  if (!personFileId) {
    return { ok: false, code: 'NO_PERSON', error: 'Upload your photo first — click the DressUp icon in your toolbar.' };
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/tryon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personFileId, garmentImageUrl, productTitle }),
    });
  } catch {
    return { ok: false, code: 'NO_SERVER', error: 'Can’t reach the DressUp server. Is it running on port 3000?' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, code: data.code || 'TRYON_FAILED', error: data.error || `Try-on failed (HTTP ${res.status}).` };
  }
  return { ok: true, ...data };
}

/** Multi-piece outfit. Each garment is a separate render server-side, so this is slow. */
async function tryOutfit({ items }) {
  const { personFileId } = await chrome.storage.local.get('personFileId');
  if (!personFileId) {
    return { ok: false, code: 'NO_PERSON', error: 'Upload your photo first — click the DressUp icon in your toolbar.' };
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/outfit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personFileId,
        items: items.map((i) => ({ garmentImageUrl: i.imageUrl, productTitle: i.title })),
      }),
    });
  } catch {
    return { ok: false, code: 'NO_SERVER', error: 'Can’t reach the DressUp server. Is it running on port 3000?' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, code: data.code || 'TRYON_FAILED', error: data.error || `Outfit failed (HTTP ${res.status}).` };
  }
  return { ok: true, ...data };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'TRY_ON') {
    tryOn(msg).then(sendResponse);
    return true; // keep the channel open for the async reply
  }
  if (msg?.type === 'TRY_OUTFIT') {
    tryOutfit(msg).then(sendResponse);
    return true;
  }
});
