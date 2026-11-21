#!/usr/bin/env node
/**
 * Copies required official visual/boot assets from the cloned AssassinVIX/fairy-zzz-plugin
 * repository into antigravity-plugin/, then installs a clean copy into
 * C:\Users\Admin\.gemini\config\plugins\fairy-zzz\.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const PLUGIN_SRC = join(REPO_ROOT, 'antigravity-plugin');
const PLUGIN_DEST = join(homedir(), '.gemini', 'config', 'plugins', 'fairy-zzz');

// Note: boot.mp4 & boot.webm inside antigravity-plugin/assets/ are transcoded to VP9
// for Chromium/Electron webview compatibility, so we preserve them rather than copying
// the upstream H.264 boot.mp4 over them.
const ASSET_COPIES = [
  ['icon.svg', 'icon.svg'],
  ['LICENSE', 'LICENSE'],
  ['NOTICE-fairy-dsh.md', 'NOTICE-fairy-dsh.md'],
  ['assets/hero.png', 'assets/hero.png'],
  ['assets/icon-180.png', 'assets/icon-180.png'],
  ['assets/poster.jpg', 'assets/poster.jpg'],
];

function sync() {
  for (const [srcRel, destRel] of ASSET_COPIES) {
    const src = join(REPO_ROOT, srcRel);
    const dest = join(PLUGIN_SRC, destRel);
    if (!existsSync(src)) {
      throw new Error(`Missing required source asset: ${src}`);
    }
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { force: true });
  }

  mkdirSync(PLUGIN_DEST, { recursive: true });
  cpSync(PLUGIN_SRC, PLUGIN_DEST, { recursive: true, force: true });

  console.log(`Synced assets into: ${PLUGIN_SRC}`);
  console.log(`Updated Antigravity plugin in-place at: ${PLUGIN_DEST}`);
}

sync();
