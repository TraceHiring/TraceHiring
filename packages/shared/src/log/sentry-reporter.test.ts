// AT-9-sentry / AT-D22, the shared Sentry adapter (spec specs/m0-foundations.md §9.2): it implements
// ErrorReporter over any SDK's captureEvent, and every consumer initialises its SDK with the same
// options (no default PII, no tracing, the scrubber as beforeSend and beforeBreadcrumb). The DSN is
// built at run time, so no DSN-shaped literal sits in the repo.
import { describe, expect, it } from 'vitest';
import { reportError } from './error-reporter.js';
import { REDACTED } from './redact.js';
import {
  createSentryReporter,
  sentryDsn,
  sentryOptions,
  toSentryEvent,
  type SentryCapture,
} from './sentry-reporter.js';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './sentry-scrub.js';
import { synth } from './synth.test-helpers.js';

const dsn = (): string => `https://${'ab12'.repeat(8)}@o1.ingest.de.sentry.io/42`;

const spy = () => {
  const calls: Parameters<SentryCapture>[] = [];
  const capture: SentryCapture = (event, hint) => {
    calls.push([event, hint]);
  };
  return { capture, calls };
};

describe('toSentryEvent', () => {
  it('builds one exception from the serialised error, newest frame last, with the release', () => {
    const event = toSentryEvent(
      {
        name: 'TypeError',
        code: '23505',
        stack: ['at inner (https://app.test/a.js:10:4)', 'at https://app.test/b.js:2:1'],
      },
      { release: 'abcdef1' },
    );
    expect(event).toEqual({
      level: 'error',
      release: 'abcdef1',
      exception: {
        values: [
          {
            type: 'TypeError',
            value: '23505',
            mechanism: { type: 'trace.report_error', handled: true },
            stacktrace: {
              frames: [
                {
                  filename: 'https://app.test/b.js',
                  function: '?',
                  lineno: 2,
                  colno: 1,
                  in_app: true,
                },
                {
                  filename: 'https://app.test/a.js',
                  function: 'inner',
                  lineno: 10,
                  colno: 4,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    });
  });

  it('uses [REDACTED] as the value when there is no code, and leaves out an absent stack', () => {
    expect(toSentryEvent({ name: 'NonError' })).toEqual({
      level: 'error',
      exception: {
        values: [
          {
            type: 'NonError',
            value: REDACTED,
            mechanism: { type: 'trace.report_error', handled: true },
          },
        ],
      },
    });
  });
});

describe('createSentryReporter', () => {
  it('captures the event with the serialised error in the hint, so the scrubber keeps its code', () => {
    const { capture, calls } = spy();
    const err = { name: 'Error', code: 'ECONNRESET' };
    createSentryReporter(capture).capture(err, { release: 'dev' });
    expect(calls).toHaveLength(1);
    const [event, hint] = calls[0]!;
    expect(hint).toEqual({ data: { serializedError: err } });
    expect(scrubSentryEvent(event, hint)?.exception?.values?.[0]?.value).toBe('ECONNRESET');
  });

  it('through reportError, no message text reaches the SDK', () => {
    const { capture, calls } = spy();
    const email = synth.email(2);
    const word = `m${synth.word(3)}`;
    reportError(createSentryReporter(capture), new Error(`failed for ${email} ${word}`), {
      release: 'abcdef1',
    });
    const text = JSON.stringify(calls);
    expect(text).not.toContain(email);
    expect(text).not.toContain(word);
  });

  it('never throws when the SDK does', () => {
    const reporter = createSentryReporter(() => {
      throw new Error('sdk down');
    });
    expect(() => reporter.capture({ name: 'Error' })).not.toThrow();
  });
});

describe('sentryDsn', () => {
  it('accepts an https DSN with a public key and a project id', () => {
    expect(sentryDsn(dsn())).toBe(dsn());
  });

  it.each([undefined, '', '  ', 'not a dsn', dsn().replace('https', 'http'), 42, `${dsn()}?x=1`])(
    'treats %s as no DSN (the SDK is not initialised)',
    (value) => {
      expect(sentryDsn(value)).toBeUndefined();
    },
  );
});

describe('sentryOptions', () => {
  it('turns off default PII and tracing and installs the scrubber', () => {
    const options = sentryOptions({ dsn: dsn(), release: 'abcdef1' });
    expect(options).toEqual({
      dsn: dsn(),
      release: 'abcdef1',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      attachStacktrace: false,
      maxBreadcrumbs: 50,
      beforeSend: scrubSentryEvent,
      beforeBreadcrumb: scrubSentryBreadcrumb,
    });
  });

  it('passes an environment that is a plain name', () => {
    expect(sentryOptions({ dsn: dsn(), release: 'dev', environment: 'staging' })?.environment).toBe(
      'staging',
    );
  });

  it('is undefined without a valid DSN, and drops a release that is not a version', () => {
    expect(sentryOptions({ dsn: undefined, release: 'abcdef1' })).toBeUndefined();
    expect(sentryOptions({ dsn: dsn(), release: synth.mobile(1) })?.release).toBeUndefined();
  });
});
