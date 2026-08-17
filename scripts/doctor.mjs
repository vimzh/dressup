#!/usr/bin/env node
/**
 * Answers "why isn't it working?" without opening a browser.
 *
 * Every check here maps to a failure that is silent or misleading at the point
 * you hit it: a missing key surfaces as a failed local API call, a busy port
 * blocks the local API, and an unbuilt dist/ surfaces as a Chrome load error.
 *
 * Key *values* are never printed — only whether they are set.
 *
 *   npm run doctor
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, note, ok, paint, portInUse, warn } from './lib/proc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = 3000;
const rel = (...p) => path.join(ROOT, ...p);

let problems = 0;
const bad = (m) => {
  problems += 1;
  fail(m);
};

console.log(paint('bold', '\nzdress doctor\n'));

// ---------------------------------------------------------------- toolchain

const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok(`Node ${process.versions.node}`);
else bad(`Node ${process.versions.node} — needs 20+`);

// ---------------------------------------------------------------- installs

for (const app of ['apps/api', 'apps/web']) {
  if (fs.existsSync(rel(app, 'node_modules'))) ok(`${app} — installed`);
  else bad(`${app} — no node_modules. Run: npm run setup`);
}

// ---------------------------------------------------------------- keys

const envPath = rel('apps/api/.env');
if (!fs.existsSync(envPath)) {
  bad('apps/api/.env is missing. Run: npm run setup');
} else {
  const text = fs.readFileSync(envPath, 'utf8');
  const valueOf = (key) => {
    const line = text.split('\n').find((l) => l.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  };
  for (const key of ['YOUCAM_API_KEY', 'OPENAI_API_KEY']) {
    if (valueOf(key)) ok(`${key} is set`);
    else bad(`${key} is blank in apps/api/.env`);
  }
}

// ---------------------------------------------------------------- extension

for (const target of ['chrome', 'firefox']) {
  const dist = rel('apps/extension/dist', target);
  if (fs.existsSync(path.join(dist, 'manifest.json'))) ok(`dist/${target} — built`);
  else bad(`dist/${target} — not built. Run: npm run build:extension`);
}

// ---------------------------------------------------------------- api

const busy = await portInUse(API_PORT);
if (!busy) {
  warn(`Nothing is listening on :${API_PORT} — the API isn't running.`);
  note('Run: npm run dev');
} else {
  try {
    const res = await fetch(`http://localhost:${API_PORT}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const health = await res.json();
    ok(`API is up on :${API_PORT}`);
    for (const [key, value] of Object.entries(health)) {
      if (typeof value === 'boolean' && !value) bad(`  health: ${key} is false`);
      else note(`health: ${key} = ${JSON.stringify(value)}`);
    }
  } catch {
    // Something else holds the port. The extension will still call it and get
    // nonsense back, which is the confusing case this check exists for.
    bad(`Port ${API_PORT} is held by something that isn't the Zdress API.`);
    note(`lsof -ti:${API_PORT} | xargs kill`);
  }
}

// ---------------------------------------------------------------- verdict

console.log();
if (problems === 0) {
  console.log(`${paint('green', paint('bold', 'All good.'))} ${paint('dim', 'npm run dev')}\n`);
} else {
  console.log(`${paint('red', paint('bold', `${problems} problem${problems > 1 ? 's' : ''}.`))}\n`);
  process.exit(1);
}
