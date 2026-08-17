#!/usr/bin/env node
/**
 * Runs the API and the web app together, under one Ctrl-C.
 *
 * The local API stays on 3000 to match development docs and curl fixtures. The
 * production extension uses the hosted API. The web app defaults to 3001.
 *
 *   npm run dev                  both
 *   npm run dev:api              just the API
 *   WEB_PORT=4000 npm run dev    move the web app
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NPM, paint, portInUse, prefixStream, warn } from './lib/proc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const API_PORT = 3000;
const WEB_PORT = Number(process.env.WEB_PORT) || 3001;

const TASKS = [
  { color: 'magenta', cwd: 'apps/api', name: 'api', port: API_PORT, script: 'dev' },
  { color: 'cyan', cwd: 'apps/web', name: 'web', port: WEB_PORT, script: 'dev' },
];

const width = Math.max(...TASKS.map((t) => t.name.length));

async function preflight() {
  let blocked = false;

  for (const task of TASKS) {
    if (!fs.existsSync(path.join(ROOT, task.cwd, 'node_modules'))) {
      console.error(`${paint('red', '✗')} ${task.cwd} has no node_modules. Run: npm run setup`);
      blocked = true;
    }
  }

  if (await portInUse(API_PORT)) {
    console.error(
      `${paint('red', '✗')} Port ${API_PORT} is already in use, so the local API cannot start.`
    );
    console.error(`  Free it first:  lsof -ti:${API_PORT} | xargs kill`);
    blocked = true;
  }

  if (await portInUse(WEB_PORT)) {
    console.error(`${paint('red', '✗')} Port ${WEB_PORT} is in use. Set WEB_PORT to something else.`);
    blocked = true;
  }

  const env = path.join(ROOT, 'apps/api/.env');
  if (!fs.existsSync(env)) {
    warn('apps/api/.env is missing — the API will start but every render will fail.');
    console.log(`  ${paint('dim', 'Run: npm run setup')}`);
  }

  if (blocked) process.exit(1);
}

await preflight();

console.log(
  `${paint('bold', 'zdress')}  ${paint('magenta', `api :${API_PORT}`)}  ${paint('cyan', `web :${WEB_PORT}`)}  ${paint('dim', 'ctrl-c to stop both')}\n`
);

const children = [];
let shuttingDown = false;

for (const task of TASKS) {
  const prefix = paint(task.color, `${task.name.padEnd(width)} │`);
  const child = spawn(NPM, ['run', task.script], {
    cwd: path.join(ROOT, task.cwd),
    env: { ...process.env, PORT: String(task.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  prefixStream(child.stdout, prefix, (line) => console.log(line));
  prefixStream(child.stderr, prefix, (line) => console.error(line));

  child.on('close', (code) => {
    if (shuttingDown) return;
    console.error(`\n${paint('red', '✗')} ${task.name} exited (${code}). Stopping the rest.`);
    shutdown(code ?? 1);
  });

  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  // Children that ignore SIGTERM shouldn't hold the terminal hostage.
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 2000).unref();
  Promise.all(
    children.map((c) => new Promise((r) => (c.exitCode === null ? c.once('close', r) : r())))
  ).then(() => process.exit(code));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
