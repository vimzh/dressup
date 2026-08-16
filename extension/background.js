/**
 * Service worker. All network calls to the backend happen here rather than in
 * the content script: the worker has host_permissions for localhost and isn't
 * subject to Myntra's page CSP.
 */

const API_BASE = 'http://localhost:3000';

async function tryOn({ garmentImageUrl, productTitle }) {
  const { personFileId } = await chrome.storage.local.get('personFileId');
  if (!personFileId) {
    return { ok: false, code: 'NO_PERSON', error: 'Upload your photo first — click the Zdress icon in your toolbar.' };
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/tryon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personFileId, garmentImageUrl, productTitle }),
    });
  } catch {
    return { ok: false, code: 'NO_SERVER', error: 'Can’t reach the Zdress server. Is it running on port 3000?' };
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
    return { ok: false, code: 'NO_PERSON', error: 'Upload your photo first — click the Zdress icon in your toolbar.' };
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
    return { ok: false, code: 'NO_SERVER', error: 'Can’t reach the Zdress server. Is it running on port 3000?' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, code: data.code || 'TRYON_FAILED', error: data.error || `Outfit failed (HTTP ${res.status}).` };
  }
  return { ok: true, ...data };
}

/**
 * Saves a render to the library. The server downloads and files the image
 * itself — YouCam's result URLs are pre-signed and expire after two hours, so
 * storing the link would leave a dead image behind.
 */
async function saveLook(payload) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/looks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: 'Can’t reach the Zdress server.' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || 'Could not save that look.' };

  chrome.runtime.sendMessage({ type: 'LOOK_SAVED' }).catch(() => {}); // panel may be closed
  return { ok: true, look: data };
}

async function listCollections() {
  try {
    const res = await fetch(`${API_BASE}/api/library`);
    const data = await res.json();
    return { ok: true, collections: data.collections || [] };
  } catch {
    return { ok: false, collections: [] };
  }
}

// Clicking the toolbar icon opens the side panel rather than a popup.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'SAVE_LOOK') {
    saveLook(msg.payload).then(sendResponse);
    return true;
  }
  if (msg?.type === 'LIST_COLLECTIONS') {
    listCollections().then(sendResponse);
    return true;
  }
  if (msg?.type === 'TRY_ON') {
    tryOn(msg).then(sendResponse);
    return true; // keep the channel open for the async reply
  }
  if (msg?.type === 'TRY_OUTFIT') {
    tryOutfit(msg).then(sendResponse);
    return true;
  }
});
