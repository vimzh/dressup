/**
 * The background script — a service worker on Chrome, an event page on Firefox,
 * which doesn't implement `background.service_worker`. Nothing here needs a
 * worker specifically, so the same file serves both.
 *
 * All network calls to the backend happen here rather than in the content
 * script: the background has host_permissions for localhost and isn't subject
 * to Myntra's page CSP.
 */

// Chrome puts the promise-based extension APIs on `chrome`, Firefox on `browser`.
globalThis.browser ??= globalThis.chrome;

const API_BASE = 'http://localhost:3000';

async function tryOn({ garmentImageUrl, productTitle, mode }) {
  const { personFileId } = await browser.storage.local.get('personFileId');
  if (!personFileId) {
    return { ok: false, code: 'NO_PERSON', error: 'Upload your photo first — click the Zdress icon in your toolbar.' };
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/tryon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personFileId, garmentImageUrl, productTitle, mode }),
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
  const { personFileId } = await browser.storage.local.get('personFileId');
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

  browser.runtime.sendMessage({ type: 'LOOK_SAVED' }).catch(() => {}); // panel may be closed
  return { ok: true, look: data };
}

/*
 * The panel is the same page on both browsers, but the API around it isn't:
 * Chrome has `sidePanel`, Firefox has `sidebarAction`, and they are not
 * compatible. Both are declared in their own manifest, so presence of the
 * namespace is what the two entry points below switch on.
 */

// Clicking the toolbar icon opens the panel rather than a popup. Chrome has a
// setting for it; Firefox needs the click handled, which also gives
// `sidebarAction.open` the user gesture it insists on.
if (browser.sidePanel) {
  browser.runtime.onInstalled.addListener(() => {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  });
} else {
  browser.action.onClicked.addListener(() => browser.sidebarAction.toggle());
}

/** Opens the panel, from whichever of the two APIs this browser has. */
function openPanel(windowId) {
  return browser.sidePanel
    ? browser.sidePanel.open({ windowId })
    : browser.sidebarAction.open();
}

/** Screening only — tells the panel a garment's slot without spending a render. */
async function classify({ garmentImageUrl, productTitle }) {
  try {
    const res = await fetch(`${API_BASE}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ garmentImageUrl, productTitle }),
    });
    if (!res.ok) return { ok: false };
    return { ok: true, ...(await res.json()) };
  } catch {
    return { ok: false };
  }
}

/**
 * The stylist. One endpoint does both halves: with no `messages` it returns the
 * opening opinion, with them it answers the follow-up.
 */
async function advice({ lookId, resultUrl, context, messages, opinion }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookId, resultUrl, context, messages, opinion }),
    });
  } catch {
    return { ok: false, error: 'Can’t reach the Zdress server. Is it running on port 3000?' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || `The stylist didn’t answer (HTTP ${res.status}).` };
  return { ok: true, ...data };
}

/**
 * A render swapped into the grid has no room for a conversation, so asking from
 * a card hands the look to the side panel and opens it.
 *
 * Opening a panel programmatically needs a user gesture on both browsers;
 * forwarding the card's click through here keeps one, but a stale message
 * channel or an unusual window can still refuse — hence the plain fallback
 * rather than a silent no-op. The look is stored first either way, so the
 * fallback text ("open Zdress from your toolbar") is true when it's shown.
 */
async function openStylist({ payload, resultUrl }, sender) {
  await browser.storage.local.set({ pendingAdvice: { resultUrl, payload, at: Date.now() } });
  try {
    await openPanel(sender?.tab?.windowId);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Open Zdress from your toolbar — the stylist is waiting on the Try on tab.' };
  }
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'ADVICE') {
    advice(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === 'ASK_STYLIST') {
    openStylist(msg, sender).then(sendResponse);
    return true;
  }
  if (msg?.type === 'CLASSIFY') {
    classify(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === 'SAVE_LOOK') {
    saveLook(msg.payload).then(sendResponse);
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
