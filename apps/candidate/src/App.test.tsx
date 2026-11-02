// The candidate shell renders on the server too (no browser API in render): the product name, the build version, a
// main landmark, exactly one h1 per step, and no inline style (CSP style-src 'self', spec m0-foundations §10.3).
// It fails closed: without a usable edge origin, or without a link, it shows "unavailable" and calls nothing.
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, PRODUCT_NAME } from './App';
import type { Boot } from './boot';
import { COPY } from './copy';
import { initialState, reducer, type Action, type FlowState } from './flow';
import { RECEIPT, viewAt } from './fixtures.test-helpers';
import { APP_VERSION } from './version';

const ORIGIN = 'https://trace-edge-staging.example-sub.workers.dev';
const boot = (over: Partial<Boot> = {}): Boot => ({
  linkToken: null,
  badLink: false,
  stored: null,
  origin: ORIGIN,
  ...over,
});
const h1s = (html: string) => [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('candidate App shell', () => {
  it('renders the product name and the version', () => {
    const html = renderToString(<App />);
    expect(PRODUCT_NAME).toBe('Trace');
    expect(html).toContain('>Trace</p>');
    expect(APP_VERSION).toMatch(/^[0-9a-f]{7,40}$|^dev$/);
    expect(html).toContain(`Version ${APP_VERSION}`);
  });

  it('has header, main and footer landmarks, one h1 and no inline style', () => {
    const html = renderToString(<App />);
    expect(html).toMatch(/<header[ >]/);
    expect(html).toMatch(/<main[ >]/);
    expect(html).toMatch(/<footer[ >]/);
    expect(h1s(html)).toHaveLength(1);
    expect(html).not.toMatch(/\sstyle=/);
  });

  it('fails closed without an edge origin, and makes no request', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const html = renderToString(<App boot={boot({ origin: null, linkToken: 'x'.repeat(43) })} />);
    expect(h1s(html)).toEqual([COPY.unavailable.title]);
    expect(html).toContain(COPY.unavailable.config);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for the invitation link when there is none, and says a bad fragment is invalid', () => {
    expect(renderToString(<App boot={boot()} />)).toContain(COPY.unavailable.noLink);
    expect(renderToString(<App boot={boot({ badLink: true })} />)).toContain(
      COPY.unavailable.invalid,
    );
  });

  it('starts at "resolving" with a link or a stored session', () => {
    const html = renderToString(<App boot={boot({ linkToken: 'A'.repeat(43) })} />);
    expect(h1s(html)).toEqual([COPY.resolving.title]);
  });
});

describe('step machine', () => {
  const start = initialState(boot({ linkToken: 'A'.repeat(43) }));
  const run = (...actions: Action[]): FlowState => actions.reduce(reducer, start);

  it('walks link → otp → age → consent → photo → rules → test → submitted', () => {
    const view = viewAt(Date.now());
    const states = [
      run({ type: 'resolved', res: { state: 'sent', title: 'T', durationMinutes: 30 } }),
      run({ type: 'lobby', lobbyToken: 'a.b.c', next: 'age' }),
      run({ type: 'lobby', lobbyToken: 'a.b.c', next: 'age' }, { type: 'adult' }),
      run({ type: 'lobby', lobbyToken: 'a.b.c', next: 'consent' }, { type: 'consented' }),
      run(
        { type: 'lobby', lobbyToken: 'a.b.c', next: 'photo' },
        { type: 'photo', photo: { skippedReason: 'declined' } },
      ),
      run({ type: 'session', sessionToken: 's.s.s', view, offsetMs: 0 }),
      run({ type: 'receipt', receipt: RECEIPT }),
    ];
    expect(states.map((s) => s.step.name)).toEqual([
      'otp',
      'age',
      'consent',
      'photo',
      'rules',
      'test',
      'submitted',
    ]);
    // The lobby token is dropped once a session exists.
    expect(states[5]?.lobbyToken).toBeNull();
  });

  it('maps each invitation state from resolve', () => {
    const name = (state: string) => run({ type: 'resolved', res: { state } as never }).step;
    expect(name('created').name).toBe('otp');
    expect(name('started').name).toBe('otp');
    expect(name('submitted')).toEqual({ name: 'unavailable', why: 'submitted' });
    expect(name('expired')).toEqual({ name: 'unavailable', why: 'expired' });
    expect(name('revoked')).toEqual({ name: 'unavailable', why: 'revoked' });
    expect(name('blocked_age')).toEqual({ name: 'blocked' });
  });

  it('a resume login (next: start) goes to the rules', () => {
    const s = run({ type: 'lobby', lobbyToken: 'a.b.c', next: 'start' });
    expect(s.step.name).toBe('rules');
  });

  it('blocked is final (rule 9): no action moves past it, and the lobby token is gone', () => {
    const blocked = run({ type: 'lobby', lobbyToken: 'a.b.c', next: 'age' }, { type: 'blocked' });
    expect(blocked).toEqual({ step: { name: 'blocked' }, lobbyToken: null });
    for (const action of [
      { type: 'adult' },
      { type: 'consented' },
      { type: 'lobby', lobbyToken: 'a.b.c', next: 'consent' },
      { type: 'photo', photo: { skippedReason: 'declined' } },
    ] as Action[])
      expect(reducer(blocked, action)).toBe(blocked);
  });

  it('a session view that carries a receipt shows the receipt', () => {
    const view = viewAt(Date.now(), { receipt: RECEIPT });
    expect(run({ type: 'session', sessionToken: 's.s.s', view, offsetMs: 0 }).step).toEqual({
      name: 'submitted',
      receipt: RECEIPT,
    });
  });
});
