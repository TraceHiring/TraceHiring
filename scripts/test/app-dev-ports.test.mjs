// F9 (docs/reviews/D1-security-review-bindings.md): both apps pin their dev and preview ports with
// `strictPort`, and the dev origins the Workers allow are exactly those ports.
//   candidate: `CANDIDATE_APP_ORIGIN` in services/api and workers/edge (env.dev.vars)
//   recruiter: `ALLOWED_ORIGINS` in services/api (env.dev.vars), the CORS allow-list for the media fetch
// Without a pin, Vite moves to the next free port when 5173 or 5174 is taken, and every cross-origin
// call then fails in a way that looks like a CORS bug. With `strictPort` it fails to start instead.
// `vite preview` is pinned to the same ports as `vite dev`: the local E2E run serves the built apps with
// `vite preview` against the `dev` Workers, so it needs the same allowed origins (d1 spec §7.1).
//
// Why here: the check reads two apps and two Workers, so it belongs to none of them. scripts/test already
// reads the wrangler.jsonc files (wrangler-bindings.test.mjs) and runs in `pnpm test` and in CI's static job.
// Each vite config is imported (its resolved `server` and `preview`), not read as text, so a port held in a
// constant or spread in from a helper is still seen.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import candidateConfig from '../../apps/candidate/vite.config.ts';
import recruiterConfig from '../../apps/recruiter/vite.config.ts';
import { parseJsonc } from '../check-boundaries.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const wrangler = (dir) => parseJsonc(readFileSync(path.join(REPO, dir, 'wrangler.jsonc'), 'utf8'));
const devVars = (dir) => wrangler(dir).env.dev.vars;

/** Vite serves on `localhost` by default, and the dev vars name that host. */
const origin = (port) => `http://localhost:${port}`;
const csv = (value) =>
  String(value ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** What is wrong with one app's pinned ports (an empty list means nothing). */
function portProblems(name, config) {
  const out = [];
  for (const key of ['server', 'preview']) {
    const section = config[key];
    if (!Number.isInteger(section?.port) || section.port < 1024 || section.port > 65535)
      out.push(`${name}: ${key}.port must be an integer from 1024 to 65535`);
    if (section?.strictPort !== true) out.push(`${name}: ${key}.strictPort must be true`);
  }
  if (config.server?.port !== config.preview?.port)
    out.push(`${name}: server.port and preview.port must be the same`);
  return out;
}

/**
 * What is wrong with the dev origins against the pinned ports.
 * @param {{ candidate: number, recruiter: number, api: Record<string, string>, edge: Record<string, string> }} x
 */
function originProblems({ candidate, recruiter, api, edge }) {
  const out = [];
  if (candidate === recruiter) out.push('the two apps must not share a port');
  for (const [where, vars] of [
    ['services/api', api],
    ['workers/edge', edge],
  ]) {
    if (vars.CANDIDATE_APP_ORIGIN !== origin(candidate))
      out.push(
        `${where} env.dev CANDIDATE_APP_ORIGIN must be ${origin(candidate)} (the candidate app's pinned port)`,
      );
  }
  const allowed = csv(api.ALLOWED_ORIGINS);
  if (!allowed.includes(origin(recruiter)))
    out.push(
      `services/api env.dev ALLOWED_ORIGINS must include ${origin(recruiter)} (the recruiter app's pinned port)`,
    );
  // A localhost origin on any other port is a stale copy of a port the apps no longer use.
  for (const entry of [...allowed, api.CANDIDATE_APP_ORIGIN, edge.CANDIDATE_APP_ORIGIN]) {
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(entry ?? '')) {
      if (entry !== origin(candidate) && entry !== origin(recruiter))
        out.push(`a dev origin names a port no app pins: ${entry}`);
    }
  }
  return out;
}

const APPS = [
  ['candidate', candidateConfig],
  ['recruiter', recruiterConfig],
];

describe('the apps pin their dev and preview ports (F9)', () => {
  it.each(APPS)(
    '%s: server.port and preview.port are one fixed port with strictPort',
    (name, config) => {
      expect(portProblems(name, config)).toEqual([]);
    },
  );

  it('gives the two apps different ports: candidate 5173, recruiter 5174', () => {
    expect(candidateConfig.server?.port).toBe(5173);
    expect(recruiterConfig.server?.port).toBe(5174);
  });
});

describe('the dev origins in the wrangler files are those ports (F9)', () => {
  const found = {
    candidate: candidateConfig.server?.port,
    recruiter: recruiterConfig.server?.port,
    api: devVars('services/api'),
    edge: devVars('workers/edge'),
  };

  it('has the dev origins in the files this test reads (it cannot pass on an empty read)', () => {
    expect(found.api.CANDIDATE_APP_ORIGIN).toMatch(/^http:\/\/localhost:\d+$/);
    expect(found.edge.CANDIDATE_APP_ORIGIN).toMatch(/^http:\/\/localhost:\d+$/);
    expect(csv(found.api.ALLOWED_ORIGINS).length).toBeGreaterThan(0);
  });

  it('matches the candidate origin in services/api and workers/edge, and the recruiter origin in services/api', () => {
    expect(originProblems(found)).toEqual([]);
  });
});

describe('the checks fail on drift (negative controls)', () => {
  const good = {
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true },
  };
  const vars = {
    api: {
      CANDIDATE_APP_ORIGIN: 'http://localhost:5173',
      ALLOWED_ORIGINS: 'http://localhost:5174',
    },
    edge: { CANDIDATE_APP_ORIGIN: 'http://localhost:5173' },
  };
  const origins = (change) => ({
    candidate: 5173,
    recruiter: 5174,
    ...structuredClone(vars),
    ...change,
  });

  it('accept the pinned shape', () => {
    expect(portProblems('x', good)).toEqual([]);
    expect(originProblems(origins({}))).toEqual([]);
  });

  it.each([
    ['no server section', { preview: good.preview }, /server\.port must be an integer/],
    ['no preview section', { server: good.server }, /preview\.port must be an integer/],
    ['no port', { ...good, server: { strictPort: true } }, /server\.port must be an integer/],
    [
      'a string port',
      { ...good, server: { port: '5173', strictPort: true } },
      /server\.port must be an integer/,
    ],
    [
      'a privileged port',
      { ...good, server: { port: 80, strictPort: true } },
      /server\.port must be an integer/,
    ],
    [
      'no strictPort on server',
      { ...good, server: { port: 5173 } },
      /server\.strictPort must be true/,
    ],
    [
      'strictPort false on preview',
      { ...good, preview: { port: 5173, strictPort: false } },
      /preview\.strictPort must be true/,
    ],
    [
      'different server and preview ports',
      { ...good, preview: { port: 4173, strictPort: true } },
      /must be the same/,
    ],
  ])('flag %s', (_label, config, message) => {
    expect(portProblems('x', config).join('\n')).toMatch(message);
  });

  it.each([
    [
      'a candidate origin on another port in services/api',
      { api: { ...vars.api, CANDIDATE_APP_ORIGIN: 'http://localhost:5180' } },
      /services\/api env\.dev CANDIDATE_APP_ORIGIN must be http:\/\/localhost:5173/,
    ],
    [
      'a candidate origin on another port in workers/edge',
      { edge: { CANDIDATE_APP_ORIGIN: 'http://localhost:4173' } },
      /workers\/edge env\.dev CANDIDATE_APP_ORIGIN must be http:\/\/localhost:5173/,
    ],
    [
      'a recruiter origin on another port',
      { api: { ...vars.api, ALLOWED_ORIGINS: 'http://localhost:5199' } },
      /ALLOWED_ORIGINS must include http:\/\/localhost:5174/,
    ],
    [
      'a stale extra dev origin',
      { api: { ...vars.api, ALLOWED_ORIGINS: 'http://localhost:5174,http://localhost:4174' } },
      /names a port no app pins: http:\/\/localhost:4174/,
    ],
    [
      'a 127.0.0.1 origin on an unpinned port',
      { api: { ...vars.api, ALLOWED_ORIGINS: 'http://localhost:5174,http://127.0.0.1:5174' } },
      /names a port no app pins: http:\/\/127\.0\.0\.1:5174/,
    ],
    [
      'an https dev origin',
      { api: { ...vars.api, ALLOWED_ORIGINS: 'https://localhost:5174' } },
      /ALLOWED_ORIGINS must include http:\/\/localhost:5174/,
    ],
    ['the two apps on one port', { recruiter: 5173 }, /must not share a port/],
  ])('flag %s', (_label, change, message) => {
    expect(originProblems(origins(change)).join('\n')).toMatch(message);
  });
});
