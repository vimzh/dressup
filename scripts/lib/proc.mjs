/**
 * Shared plumbing for the root scripts: coloured line prefixes and a child
 * runner that streams output as it arrives rather than buffering to the end.
 *
 * Kept dependency-free on purpose — the repo installs nothing at the root, and
 * a setup script that needs `npm install` before it can run is no setup script.
 */

import { spawn } from 'node:child_process';

const NO_COLOR = Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;

const CODES = {
  bold: '1',
  cyan: '36',
  dim: '2',
  green: '32',
  magenta: '35',
  red: '31',
  yellow: '33',
};

export function paint(color, text) {
  if (NO_COLOR) return text;
  return `[${CODES[color]}m${text}[0m`;
}

export const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export const ok = (m) => console.log(`${paint('green', '✓')} ${m}`);
export const warn = (m) => console.log(`${paint('yellow', '!')} ${m}`);
export const fail = (m) => console.log(`${paint('red', '✗')} ${m}`);
export const note = (m) => console.log(`  ${paint('dim', m)}`);

/**
 * Streams a child's output with a fixed prefix. Partial lines are held back
 * until their newline arrives, so two children writing at once can't interleave
 * mid-word into an unreadable mess.
 */
export function prefixStream(stream, prefix, onLine) {
  let tail = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const lines = (tail + chunk).split('\n');
    tail = lines.pop() ?? '';
    for (const line of lines) onLine(`${prefix} ${line}`);
  });
  stream.on('end', () => {
    if (tail) onLine(`${prefix} ${tail}`);
  });
}

/** Runs a command to completion, inheriting stdio. Resolves with the exit code. */
export function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

/**
 * True when something is already listening on the port.
 *
 * Binds with no host — every interface — because that is what `app.listen(port)`
 * does. Probing 127.0.0.1 instead reports the port free while an IPv6 `*:3000`
 * listener holds it, which is precisely the false all-clear this exists to
 * prevent.
 */
export async function portInUse(port) {
  const { createServer } = await import('node:net');
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port);
  });
}
