/**
 * YouCam (Perfect Corp) Apparel Virtual Try-On client.
 *
 * Flow, per https://yce.perfectcorp.com/document/index.html:
 *   1. POST /s2s/v2.0/file/cloth  -> reserves a file_id + a pre-signed upload target
 *   2. PUT the raw bytes to that pre-signed target
 *   3. POST /s2s/v2.0/task/cloth  -> starts an async try-on task
 *   4. GET  /s2s/v2.0/task/cloth/{id} -> poll until success
 *
 * The published docs don't pin down the exact response envelope, so field
 * lookups here go through `dig()` — a breadth-first search for the first key
 * matching a set of candidate names. That way a nested `{result: {...}}` vs a
 * flat body doesn't break the integration.
 */

const BASE = process.env.YOUCAM_BASE_URL || 'https://yce-api-01.makeupar.com';

function authHeaders() {
  const key = process.env.YOUCAM_API_KEY;
  if (!key) throw new Error('YOUCAM_API_KEY is not set. Copy server/.env.example to server/.env and fill it in.');
  return { Authorization: `Bearer ${key}` };
}

/** Breadth-first search for the first value whose key matches one of `names`. */
function dig(obj, names, { predicate } = {}) {
  const want = new Set(names);
  const queue = [obj];
  while (queue.length) {
    const node = queue.shift();
    if (node === null || typeof node !== 'object') continue;
    for (const [k, v] of Object.entries(node)) {
      if (want.has(k) && v !== null && v !== undefined && (!predicate || predicate(v))) return v;
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') queue.push(v);
    }
  }
  return undefined;
}

async function callJson(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`YouCam ${method} ${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`YouCam ${method} ${path} failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
  }
  return json;
}

/**
 * Uploads an image and returns a reusable file_id.
 * `kind` selects the upload channel: 'cloth' for garments, 'image' for the person photo.
 */
/** Documented input limits: jpg/jpeg/png, under 10MB, long side at most 4096px. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];

export async function uploadImage(buffer, { fileName, contentType, kind = 'cloth' }) {
  if (!ALLOWED_TYPES.includes(contentType.toLowerCase())) {
    throw new Error(`Unsupported image type "${contentType}". Use a JPG or PNG.`);
  }
  if (buffer.length >= MAX_UPLOAD_BYTES) {
    throw new Error(`Image is ${(buffer.length / 1024 / 1024).toFixed(1)}MB. The limit is 10MB.`);
  }

  const reserve = await callJson('POST', `/s2s/v2.0/file/${kind}`, {
    files: [{ content_type: contentType, file_name: fileName, file_size: buffer.length }],
  });

  const fileId = dig(reserve, ['file_id', 'fileId']);
  if (!fileId) throw new Error(`No file_id in YouCam upload response: ${JSON.stringify(reserve).slice(0, 500)}`);

  // The upload target lives under `requests` — either an object or a one-element array.
  const reqNode = dig(reserve, ['requests', 'request']);
  const target = Array.isArray(reqNode) ? reqNode[0] : reqNode;
  const url = target?.url || dig(reserve, ['url'], { predicate: (v) => typeof v === 'string' && v.startsWith('http') });
  if (!url) throw new Error(`No upload URL in YouCam response: ${JSON.stringify(reserve).slice(0, 500)}`);

  const method = (target?.method || 'PUT').toUpperCase();
  const headers = { 'Content-Type': contentType, ...(target?.headers || {}) };

  const put = await fetch(url, { method, headers, body: buffer });
  if (!put.ok) {
    throw new Error(`Upload to pre-signed URL failed (HTTP ${put.status}): ${(await put.text()).slice(0, 300)}`);
  }
  return fileId;
}

/**
 * The complete set the endpoint accepts, confirmed by probing it directly.
 * "outerwear" appears in Perfect Corp's marketing copy but is rejected by the API.
 */
export const GARMENT_CATEGORIES = ['auto', 'upper_body', 'lower_body', 'full_body', 'shoes'];

/** Starts a try-on task and returns its task_id. */
export async function createClothTask({ personFileId, garmentFileId, garmentCategory = 'auto', changeShoes = false }) {
  // Guard locally: an unknown category makes the API return "ref_file_url is
  // required", which sends you hunting through the upload code for no reason.
  if (!GARMENT_CATEGORIES.includes(garmentCategory)) {
    throw new Error(
      `Invalid garment_category "${garmentCategory}". Expected one of: ${GARMENT_CATEGORIES.join(', ')}.`
    );
  }

  const json = await callJson('POST', '/s2s/v2.0/task/cloth', {
    src_file_id: personFileId,
    ref_file_id: garmentFileId,
    garment_category: garmentCategory,
    change_shoes: changeShoes,
  });
  const taskId = dig(json, ['task_id', 'taskId']);
  if (!taskId) throw new Error(`No task_id in YouCam task response: ${JSON.stringify(json).slice(0, 500)}`);
  return taskId;
}

/**
 * Polls a task to completion and returns the result image URL.
 * Try-on typically takes 10-30s; the ceiling here is deliberately generous.
 */
export async function pollClothTask(taskId, { intervalMs = 2000, timeoutMs = 120000, onProgress } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const json = await callJson('GET', `/s2s/v2.0/task/cloth/${taskId}`);

    // `task_status` must be read explicitly: the response envelope carries its
    // own numeric `status: 200`, which a generic key search would hit first.
    const status = String(
      dig(json, ['task_status', 'taskStatus'], { predicate: (v) => typeof v === 'string' }) ?? ''
    ).toLowerCase();
    onProgress?.(status || '(unknown)');

    if (status === 'success' || status === 'succeeded' || status === 'completed') {
      // Documented field is `result_image_url`; the rest are defensive fallbacks.
      const url = dig(json, ['result_image_url', 'url', 'result_url', 'output_url', 'image_url'], {
        predicate: (v) => typeof v === 'string' && v.startsWith('http'),
      });
      if (!url) throw new Error(`Task succeeded but no result URL found: ${JSON.stringify(json).slice(0, 500)}`);
      return url;
    }
    if (status === 'error' || status === 'failed') {
      const reason = dig(json, ['error', 'error_message', 'message']) ?? 'unknown error';
      throw new Error(`Try-on task failed: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Try-on timed out after ${Math.round(timeoutMs / 1000)}s`);
}
