// Starts the two local "sites" for the browser spikes: the media Worker (wrangler dev) and a tiny static server that
// stands in for the recruiter app and serves the real recruiter CSP. Synthetic data only.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  OUT_DIR,
  SITE_ORIGIN,
  SITE_PORT,
  SPIKE_DIR,
  WORKER_ORIGIN,
  WORKER_PORT,
  recruiterHeaders,
  type CspVariant,
} from './env.ts';

const SITE_DIR = path.join(SPIKE_DIR, 'browser', 'site');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
const VARIANT_BY_PATH: Record<string, CspVariant> = {
  '/': 'strict',
  '/img-allowed': 'img-allowed',
  '/unmodified': 'unmodified',
};

export function startSite(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', SITE_ORIGIN).pathname;
    if (pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    const variant = VARIANT_BY_PATH[pathname];
    let file: string | undefined;
    const headers: Record<string, string> = {};
    if (variant) {
      // The three recruiter-page variants all serve the same HTML; only the CSP header differs.
      file = path.join(SITE_DIR, 'recruiter.html');
      const h = recruiterHeaders(variant);
      headers['Content-Security-Policy'] = h.csp;
      Object.assign(headers, h.others);
    } else if (pathname === '/page.js') {
      file = path.join(SITE_DIR, 'page.js');
      Object.assign(headers, recruiterHeaders('strict').others);
    } else if (pathname === '/d6') {
      file = path.join(SITE_DIR, 'd6.html'); // candidate-app stand-in: no CSP, no Permissions-Policy
    }
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      ...headers,
    });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(SITE_PORT, 'localhost', () => resolve(server));
  });
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

export interface MediaWorker {
  bootMs: number;
  stop(): void;
}

/** `wrangler dev` for workers/media-link with a per-run random HMAC key in a git-ignored .dev.vars. */
export async function startMediaWorker(): Promise<MediaWorker> {
  const cfgDir = path.join(SPIKE_DIR, 'workers', 'media-link');
  const devVars = path.join(cfgDir, '.dev.vars');
  const state = path.join(OUT_DIR, 'wrangler-state');
  fs.rmSync(state, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    devVars,
    [
      `MEDIA_LINK_HMAC_KEY=${randomBytes(32).toString('base64')}`,
      'SPIKE_ROUTES=1',
      `ALLOWED_ORIGINS=${SITE_ORIGIN}`,
      '',
    ].join('\n'),
  );
  const log = fs.openSync(path.join(OUT_DIR, 'wrangler-dev.log'), 'w');
  const t0 = performance.now();
  const child = spawn(
    process.execPath,
    [
      path.join(SPIKE_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'dev',
      '-c',
      path.join(cfgDir, 'wrangler.jsonc'),
      '--ip',
      '127.0.0.1',
      '--port',
      String(WORKER_PORT),
      '--inspector-port',
      '9341',
      '--persist-to',
      state,
      '--log-level',
      'info',
    ],
    {
      cwd: SPIKE_DIR,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_LOG_PATH: path.join(OUT_DIR, 'wrangler-logs'),
        NO_COLOR: '1',
      },
    },
  );
  let exited: number | null = null;
  child.once('exit', (code) => {
    exited = code ?? -1;
  });
  const stop = () => {
    killTree(child);
    fs.rmSync(devVars, { force: true });
  };
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (exited !== null) {
      stop();
      throw new Error(
        `wrangler dev exited with ${exited}; see ${path.join(OUT_DIR, 'wrangler-dev.log')}`,
      );
    }
    try {
      const r = await fetch(`${WORKER_ORIGIN}/health`);
      if (r.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      stop();
      throw new Error('wrangler dev did not become healthy within 120 s');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { bootMs: Math.round(performance.now() - t0), stop };
}
