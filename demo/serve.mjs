// Tiny static server for the Trace demo prototype. Node built-ins only.
// It applies demo/site/_headers (Cloudflare Pages format) so CSP problems show up locally.
// Usage: node demo/serve.mjs   (PORT=8788 by default, bound to 127.0.0.1)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'site');
const port = Number(process.env.PORT ?? 8788);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Parses a Cloudflare Pages `_headers` file into [{ pattern, headers }]. */
function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const idx = raw.indexOf(':');
    if (current && idx > 0) {
      current.headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
    }
  }
  return rules;
}

function matches(pattern, urlPath) {
  if (pattern.endsWith('*')) return urlPath.startsWith(pattern.slice(0, -1));
  return pattern === urlPath;
}

const headerRules = parseHeaders(readFileSync(path.join(root, '_headers'), 'utf8'));

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let urlPath = decodeURIComponent(url.pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.normalize(path.join(root, urlPath));
  for (const rule of headerRules) {
    if (matches(rule.pattern, url.pathname)) {
      for (const [name, value] of rule.headers) res.setHeader(name, value);
    }
  }
  if (!filePath.startsWith(root + path.sep) || path.basename(filePath) === '_headers') {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Trace demo prototype: http://localhost:${port}/`);
});
