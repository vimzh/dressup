#!/usr/bin/env node
/**
 * Takes a fresh clone to a state where `npm run dev` works.
 *
 * Installs each app's dependencies, creates apps/api/.env from the example if
 * it isn't there, and builds both extension targets so dist/ exists before
 * anyone opens chrome://extensions. Safe to re-run: every step is a no-op when
 * it has already been done.
 *
 *   npm run setup
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NPM, note, ok, paint, run, warn } from './lib/proc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_NODE = 20;

const rel = (...p) => path.join(ROOT, ...p);

console.log(paint('bold', '\nzdress setup\n'));

// ---------------------------------------------------------------- node

const major = Number(process.versions.node.split('.')[0]);
if (major < MIN_NODE) {
  console.error(
    `${paint('red', '✗')} Node ${process.versions.node} is too old. Next 16 and \`node --watch\` need ${MIN_NODE}+.`
  );
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

// ---------------------------------------------------------------- deps

// The extension is deliberately dependency-free — its build script is plain
// node — so there is nothing to install for it.
for (const app of ['apps/api', 'apps/web']) {
  if (fs.existsSync(rel(app, 'node_modules'))) {
    ok(`${app} — dependencies already installed`);
    continue;
  }
  console.log(`${paint('dim', '→')} installing ${app} …`);
  const code = await run(NPM, ['install'], { cwd: rel(app) });
  if (code !== 0) {
    console.error(`${paint('red', '✗')} npm install failed in ${app}`);
    process.exit(code);
  }
  ok(`${app} — installed`);
}

// ---------------------------------------------------------------- env

const env = rel('apps/api/.env');
const example = rel('apps/api/.env.example');

if (fs.existsSync(env)) {
  ok('apps/api/.env exists');
} else if (fs.existsSync(example)) {
  fs.copyFileSync(example, env);
  warn('apps/api/.env created from the example — the keys are still blank.');
  note('YOUCAM_API_KEY  https://yce.makeupar.com/api-console/en/api-keys/');
  note('OPENAI_API_KEY  https://platform.openai.com/api-keys');
} else {
  warn('No apps/api/.env.example to copy from.');
}

// ---------------------------------------------------------------- extension

console.log(`${paint('dim', '→')} building the extension …`);
const built = await run(NPM, ['run', 'build'], { cwd: rel('apps/extension') });
if (built !== 0) {
  console.error(`${paint('red', '✗')} extension build failed`);
  process.exit(built);
}

// ---------------------------------------------------------------- next

console.log(`\n${paint('bold', 'Next:')}`);
note('1. Put your keys in apps/api/.env');
note('2. npm run dev            api on :3000, web on :3001');
note('3. npm run doctor         check everything is wired up');
note('4. chrome://extensions → Developer mode → Load unpacked → apps/extension/dist/chrome');
console.log();
