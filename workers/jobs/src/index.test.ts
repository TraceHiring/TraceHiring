// AT-10 (spec §13): the Worker's GET /health returns a body that is valid against the HealthResponse
// contract and carries the injected VERSION. Runs inside the Workers runtime through
// @cloudflare/vitest-pool-workers. vitest.config.ts is lead-only, so VERSION is overridden through
// the env handed to fetch, not through the wrangler vars.
import { HealthResponse, LogLine } from '@trace/shared/contracts';
import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

const SERVICE = 'jobs';
const SHA_40 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

// The handler never reads ctx; a minimal stand-in is enough to call the Worker with a custom env.
const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

// The deployed env with some vars replaced. The cast lets a test pass values that the generated
// Env type would not allow, such as an unset or invalid VERSION.
const withEnv = (overrides: Record<string, unknown>): Env => ({ ...env, ...overrides }) as Env;

const callWorker = (path: string, workerEnv: Env, init?: RequestInit) =>
  worker.fetch(new Request(`https://${SERVICE}.test${path}`, init), workerEnv, ctx);

const fetchWith = (path: string, overrides: Record<string, unknown>, init?: RequestInit) =>
  callWorker(path, withEnv(overrides), init);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /health (AT-10)', () => {
  it('answers with a HealthResponse and cache-control: no-store', async () => {
    const response = await exports.default.fetch(`https://${SERVICE}.test/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = HealthResponse.parse(await response.json());
    expect(body.status).toBe('ok');
    expect(body.service).toBe(SERVICE);
    expect(Math.abs(Date.now() - Date.parse(body.time))).toBeLessThan(5 * 60 * 1000);
  });

  it('reports dev when the config carries the default VERSION', async () => {
    const response = await exports.default.fetch(`https://${SERVICE}.test/health`);

    expect(HealthResponse.parse(await response.json()).version).toBe('dev');
  });

  it.each([['abcdef1'], [SHA_40], ['dev']])('carries the injected VERSION %s', async (version) => {
    const response = await fetchWith('/health', { VERSION: version });

    expect(response.status).toBe(200);
    expect(HealthResponse.parse(await response.json()).version).toBe(version);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['a branch name', 'main'],
    ['too short', 'abcdef'],
    ['too long', `${SHA_40}0`],
    ['upper case', 'ABCDEF1'],
    ['not hex', 'ghijklm'],
    ['not a string', 1234567],
  ])('falls back to dev when VERSION is %s', async (_label, version) => {
    const response = await fetchWith('/health', { VERSION: version });

    expect(response.status).toBe(200);
    expect(HealthResponse.parse(await response.json()).version).toBe('dev');
  });

  it('answers HEAD without a body', async () => {
    const response = await fetchWith('/health', {}, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });
});

describe('unknown requests', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/anything'],
    ['GET', '/health/extra'],
    ['POST', '/health'],
  ])('%s %s answers 404 JSON', async (method, path) => {
    const response = await fetchWith(path, {}, { method });

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});

describe('the error path', () => {
  // A VERSION that throws when read makes the /health handler fail. The error path must then
  // answer 500 without reading it again, and without leaking the message or a stack.
  const brokenEnv = (message: string): Env =>
    Object.defineProperty({ ...env }, 'VERSION', {
      enumerable: true,
      get(): never {
        throw new Error(message);
      },
    });

  // Built at run time so no PII-shaped literal sits in the repo.
  const synthetic = (): string => ['pat', 'example.test'].join('@');

  it('answers 500 {"error":"internal"} with no message and no stack', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const secret = synthetic();

    const response = await callWorker('/health', brokenEnv(`failed for ${secret}`));

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).toBe('{"error":"internal"}');
    expect(text).not.toContain(secret);
    expect(text).not.toMatch(/\bat\s|stack|Error:/);
    // The failure is logged once, through the redacting logger, without the message.
    expect(lines).toHaveLength(1);
    const line = LogLine.parse(JSON.parse(lines[0] ?? ''));
    expect(line).toMatchObject({ level: 'error', service: SERVICE, version: 'dev' });
    expect(lines[0]).not.toContain(secret);
  });
});
