#!/usr/bin/env node
// Deploy to Cloudflare Pages. Stages a clean copy of HEAD, then stamps every
// relative module import with the build version from index.html — the same
// rewrite dev-server.mjs does with its boot timestamp. Without this, a deploy
// can pair a fresh main.js?v=N with a stale cached sibling module: Pages
// serves /src/*.js with max-age=14400, so browsers hold modules for four
// hours without revalidating. (_headers turns future responses into
// revalidate-always; the stamping covers caches already warmed.)
//
// Usage: node deploy.mjs

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const stage = mkdtempSync(join(tmpdir(), 'samurai-deploy-'));
execSync(`git archive HEAD | tar -x -C "${stage}"`);
rmSync(join(stage, '.claude'), { recursive: true, force: true });

const index = readFileSync(join(stage, 'index.html'), 'utf8');
const version = (index.match(/src\/main\.js\?v=(\w+)/) || [])[1];
if (!version) throw new Error('index.html has no versioned main.js script tag');

const stamp = (src) => src
  // import ... from './x.js'  |  export ... from './x.js'
  .replace(/((?:import|export)[^'"\n]*from\s*['"])(\.{1,2}\/[^'"?]+)(['"])/g, `$1$2?v=${version}$3`)
  // bare side-effect imports: import './x.js'
  .replace(/(import\s*['"])(\.{1,2}\/[^'"?]+)(['"])/g, `$1$2?v=${version}$3`);

for (const file of readdirSync(join(stage, 'src'))) {
  if (!file.endsWith('.js')) continue;
  const path = join(stage, 'src', file);
  writeFileSync(path, stamp(readFileSync(path, 'utf8')));
}

// The service worker's cache name carries the build, so each deploy installs a
// fresh worker and clears the previous build's cache on activation.
const swPath = join(stage, 'sw.js');
writeFileSync(swPath, readFileSync(swPath, 'utf8').replaceAll('__BUILD__', version));

execSync(`npx wrangler pages deploy "${stage}" --project-name=samurai --branch=master`, { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
