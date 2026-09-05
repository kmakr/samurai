// Minimal static server for development.
//
// Exists for one reason: python -m http.server sends no Cache-Control, and
// Chrome's heuristic caching then serves stale ES modules after edits — the
// page looks updated while running week-old code. Every response here is
// no-cache, so the browser revalidates on each load.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { stampImports as stampModules } from './tools/stamp-imports.mjs';
import { extname, join, normalize } from 'node:path';

const PORT = process.env.PORT || 5173;
const ROOT = new URL('.', import.meta.url).pathname;

// Version stamp appended to every relative import in served JS/HTML. Chrome
// keeps ES modules in a per-page module map keyed by URL, and no-cache alone
// has proven insufficient to evict them — a changed URL is the only reliable
// bust. New stamp per server start.
let BOOT = Date.now().toString(36);
// Refresh the whole ES-module graph after an edit, including gallery imports.
watch(ROOT, { recursive: true }, (_event, file) => {
  if (file && /\.(?:js|mjs|html|css)$/.test(file) && !file.startsWith('.git/')) BOOT = Date.now().toString(36);
});

function stampImports(src) { return stampModules(src, `t=${BOOT}`); }

function stampHtml(src) {
  return stampImports(src).replace(/((?:src|href)=")(\.\/src\/[^"?]+)(?:\?[^"]*)?(")/g, `$1$2?t=${BOOT}$3`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    let body = await readFile(file);
    const ext = extname(file);
    if (ext === '.js' || ext === '.mjs') body = stampImports(body.toString());
    else if (ext === '.html') body = stampHtml(body.toString());
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`dev server on http://127.0.0.1:${PORT}`));
