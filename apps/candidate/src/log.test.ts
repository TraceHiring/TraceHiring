// The candidate logs to the console through the redacting logger only (spec §9.1, §9.2): one JSON
// line per call, shaped as the LogLine contract (§9.4).
import { LogLine } from '@trace/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from './log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('candidate logger', () => {
  it('writes one LogLine to the console, as service "candidate"', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('app.start');
    expect(spy).toHaveBeenCalledTimes(1);
    const line = LogLine.parse(JSON.parse(String(spy.mock.calls[0]?.[0])));
    expect(line).toMatchObject({ service: 'candidate', level: 'info', event: 'app.start' });
  });

  it('redacts what it is given', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const email = `${'a1b2c3'}@${'example'}.test`;
    log.warn('app.test_event', { email, note: `contact ${email}` });
    const text = String(spy.mock.calls[0]?.[0]);
    expect(text).not.toContain(email);
    expect(text).toContain('[REDACTED]');
  });
});
