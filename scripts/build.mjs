#!/usr/bin/env node
/**
 * Assembles a loadable extension per browser.
 *
 * There is one copy of the code (`extension/shared`) and one copy of everything
 * both manifests agree on (`extension/manifest.base.json`) — the retailer match
 * list and the version number in particular, which are exactly the things that
 * rot when two manifests are maintained side by side. A target directory holds
 * only its differences: Chrome's service worker and `side_panel`, Firefox's
 * event page and `sidebar_action`.
 *
 *   node scripts/build.mjs                 both targets
 *   node scripts/build.mjs firefox         one target
 *   node scripts/build.mjs --zip           also package dist/<target>.zip
 *
 * Any file dropped into a target directory is copied over the shared build, so
 * a browser-specific override needs no change here.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'dist');
const TARGETS = ['chrome', 'firefox'];

const args = process.argv.slice(2);
const zip = args.includes('--zip');
const picked = args.filter((a) => !a.startsWith('--'));
const targets = picked.length ? picked : TARGETS;

for (const t of targets) {
  if (!TARGETS.includes(t)) {
    console.error(`Unknown target "${t}". Expected one of: ${TARGETS.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Top-level keys only. A deep merge would let a target quietly half-override
 * `content_scripts` and leave the result hard to read; whole keys are replaced,
 * which is why Chrome restates `permissions` in full to add one entry.
 */
function manifestFor(target) {
  const base = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.base.json'), 'utf8'));
  const overlay = JSON.parse(fs.readFileSync(path.join(SRC, target, 'manifest.json'), 'utf8'));
  return { ...base, ...overlay };
}

/**
 * Every path a manifest names has to exist in the build. Two manifests over one
 * source tree is precisely where a renamed file goes unnoticed in the browser
 * you didn't happen to reload.
 */
function verify(dir, manifest) {
  const referenced = [
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
    manifest.side_panel?.default_path,
    manifest.sidebar_action?.default_panel,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...Object.values(manifest.sidebar_action?.default_icon ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
  ].filter(Boolean);

  const missing = [...new Set(referenced)].filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) {
    console.error(`✗ ${path.basename(dir)}: manifest references missing file(s): ${missing.join(', ')}`);
    process.exit(1);
  }
}

function build(target) {
  const dir = path.join(OUT, target);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  fs.cpSync(path.join(SRC, 'shared'), dir, { recursive: true });

  // The target's own files land on top; its manifest.json is written from the
  // merge below rather than copied, so it isn't the fragment that ships.
  fs.cpSync(path.join(SRC, target), dir, {
    recursive: true,
    filter: (s) => path.basename(s) !== 'manifest.json',
  });

  const manifest = manifestFor(target);
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  verify(dir, manifest);

  const files = fs.readdirSync(dir, { recursive: true }).length;
  console.log(`✓ ${target}  →  dist/${target}  (${files} files, v${manifest.version})`);

  if (zip) {
    const archive = path.join(OUT, `zdress-${target}-${manifest.version}.zip`);
    fs.rmSync(archive, { force: true });
    try {
      // Zipped from inside the build: both stores want manifest.json at the
      // root of the archive, not one directory down.
      execFileSync('zip', ['-qr', '-FS', archive, '.'], { cwd: dir });
      console.log(`  packaged  →  ${path.relative(ROOT, archive)}`);
    } catch {
      console.warn(`  could not package ${target} — the "zip" command is not available.`);
    }
  }
}

targets.forEach(build);

console.log(
  targets.includes('chrome')
    ? '\nChrome:  chrome://extensions → Developer mode → Load unpacked → dist/chrome'
    : ''
);
console.log(
  targets.includes('firefox')
    ? 'Firefox: about:debugging → This Firefox → Load Temporary Add-on → dist/firefox/manifest.json'
    : ''
);
