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

const API_BASE = 'https://zdress-api.vercel.app';

const clientIdPromise = browser.storage.local.get('clientId').then(async ({ clientId }) => {
  if (clientId) return clientId;
  const created = crypto.randomUUID();
  await browser.storage.local.set({ clientId: created });
  return created;
});

async function apiHeaders(headers = {}) {
  return { ...headers, 'X-Zdress-Client-Id': await clientIdPromise };
}

async function tryOn({ garmentImageUrl, productTitle, mode }) {
  const { personFileId } = await browser.storage.local.get('personFileId');
  if (!personFileId) {
    return { ok: false, code: 'NO_PERSON', error: 'Upload your photo first — click the Zdress icon in your toolbar.' };
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/tryon`, {
      method: 'POST',
      headers: await apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ personFileId, garmentImageUrl, productTitle, mode }),
    });
  } catch {
    return { ok: false, code: 'NO_SERVER', error: 'Can’t reach Zdress right now. Check your connection and try again.' };
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
      headers: await apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        personFileId,
        items: items.map((i) => ({ garmentImageUrl: i.imageUrl, productTitle: i.title })),
      }),
    });
  } catch {
    return { ok: false, code: 'NO_SERVER', error: 'Can’t reach Zdress right now. Check your connection and try again.' };
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
      headers: await apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: 'Can’t reach Zdress right now.' };
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

/*
 * ── Sites the user opts into ───────────────────────────────────────────────
 *
 * The manifest names the retailers we ship adapters for, but sites.js also
 * carries a generic Shopify adapter, and there is no list of Shopify domains to
 * put in a manifest. So those stores are reached the other way round: the user
 * grants one origin from the side panel, and the content script is injected
 * programmatically from here.
 *
 * `permissions.contains` is the only record of which sites those are. Storing a
 * list alongside it would drift the moment someone revokes a site from the
 * browser's own extension settings, which never tells us.
 *
 * Declared retailers are not affected: `content_scripts.matches` are not host
 * permissions, so `contains` is false for Myntra and the injection path below
 * never touches it. The guard in content.js covers the rest.
 */

const INJECT_FILES = ['sites.js', 'content.js'];

/** True once the content script is running and an adapter claimed the page. */
async function injectInto(tabId) {
  await browser.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
  await browser.scripting.executeScript({ target: { tabId }, files: INJECT_FILES });

  // Runs in the same isolated world the files just landed in, so it can ask
  // sites.js directly whether anything matched rather than guessing from the URL.
  const [{ result } = {}] = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const site = window.ZdressSites?.siteFor();
      return site ? { matched: true, label: site.label } : { matched: false };
    },
  });
  return result || { matched: false };
}

function originOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? `${u.origin}/*` : null;
  } catch {
    return null;
  }
}

/**
 * Called from the panel once the user has granted the origin. The grant has to
 * happen there: `permissions.request` needs a user gesture on an extension page,
 * which a background worker doesn't have.
 */
async function enableSite({ tabId, url }) {
  const origin = originOf(url);
  if (!origin) return { ok: false, error: 'Zdress can only be enabled on a normal web page.' };

  const granted = await browser.permissions.contains({ origins: [origin] });
  if (!granted) return { ok: false, error: 'Zdress needs permission for this site to switch itself on.' };

  try {
    return { ok: true, ...(await injectInto(tabId)) };
  } catch {
    return { ok: false, error: 'Could not start Zdress on this page. Try reloading it.' };
  }
}

/*
 * A granted origin has to survive the next visit, and nothing re-injects for us.
 * Firing on `complete` rather than earlier means the Shopify detector in sites.js
 * is reading a painted grid rather than an empty shell.
 */
browser.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const origin = originOf(tab?.url);
  if (!origin) return;
  if (!(await browser.permissions.contains({ origins: [origin] }))) return;
  injectInto(tabId).catch(() => {}); // tab may have navigated away again
});

/** Screening only — tells the panel a garment's slot without spending a render. */
async function classify({ garmentImageUrl, productTitle }) {
  try {
    const res = await fetch(`${API_BASE}/api/classify`, {
      method: 'POST',
      headers: await apiHeaders({ 'Content-Type': 'application/json' }),
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
      headers: await apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ lookId, resultUrl, context, messages, opinion }),
    });
  } catch {
    return { ok: false, error: 'Can’t reach Zdress right now. Check your connection and try again.' };
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
  if (msg?.type === 'ENABLE_SITE') {
    enableSite(msg).then(sendResponse);
    return true;
  }
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
