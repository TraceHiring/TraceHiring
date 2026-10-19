// The test timer's arithmetic (specs/d1-demo-slice.md §4.7, RT-10): remaining time is the server deadline read
// through `offset = serverNow − midpoint(send, receive)`, so a shifted client clock changes nothing; the polite
// announcement changes only at 10, 5 and 1 minutes and 30 seconds; the visible clock rounds up.
import { describe, expect, it } from 'vitest';
import { COPY } from '../copy';
import { offsetOf } from '../flow';
import { announcementFor, formatRemaining, remainingMs } from './clock';

const SERVER_NOW = Date.parse('2026-10-19T10:00:00.000Z');
const DEADLINE = SERVER_NOW + 25 * 60_000;

describe('RT-10: a shifted client clock gives the same remaining time', () => {
  for (const shift of [0, 3_600_000, -3_600_000, 86_400_000, -123_457]) {
    it(`client clock shifted by ${shift} ms`, () => {
      // The request took 400 ms on the client's clock; the server answered at its midpoint.
      const sentAt = SERVER_NOW - 200 + shift;
      const receivedAt = SERVER_NOW + 200 + shift;
      const offset = offsetOf(new Date(SERVER_NOW).toISOString(), sentAt, receivedAt);
      expect(offset === -shift).toBe(true);
      // Thirty seconds later on the (shifted) client clock.
      const later = receivedAt + 30_000;
      expect(remainingMs(DEADLINE, offset, later)).toBe(25 * 60_000 - 30_200);
    });
  }

  it('never goes below zero', () => {
    expect(remainingMs(DEADLINE, 0, DEADLINE + 5_000)).toBe(0);
  });
});

describe('announcementFor', () => {
  it('speaks only at 10, 5 and 1 minutes and 30 seconds', () => {
    const cases: [number, string][] = [
      [60 * 60_000, ''],
      [10 * 60_000 + 1, ''],
      [10 * 60_000, COPY.test.announce.tenMinutes],
      [5 * 60_000 + 1, COPY.test.announce.tenMinutes],
      [5 * 60_000, COPY.test.announce.fiveMinutes],
      [60_000 + 1, COPY.test.announce.fiveMinutes],
      [60_000, COPY.test.announce.oneMinute],
      [30_001, COPY.test.announce.oneMinute],
      [30_000, COPY.test.announce.thirtySeconds],
      [1, COPY.test.announce.thirtySeconds],
      [0, ''],
    ];
    for (const [ms, text] of cases) expect(announcementFor(ms), String(ms)).toBe(text);
  });

  it('changes value exactly four times over a whole test (so the live region speaks four times)', () => {
    const values: string[] = [];
    for (let ms = 30 * 60_000; ms > 0; ms -= 250) {
      const v = announcementFor(ms);
      if (v !== values.at(-1)) values.push(v);
    }
    expect(values.filter((v) => v !== '')).toEqual([
      COPY.test.announce.tenMinutes,
      COPY.test.announce.fiveMinutes,
      COPY.test.announce.oneMinute,
      COPY.test.announce.thirtySeconds,
    ]);
  });
});

describe('formatRemaining', () => {
  it('rounds up to the second and shows hours from one hour', () => {
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(-5)).toBe('00:00');
    expect(formatRemaining(1)).toBe('00:01');
    expect(formatRemaining(999)).toBe('00:01');
    expect(formatRemaining(1_000)).toBe('00:01');
    expect(formatRemaining(1_001)).toBe('00:02');
    expect(formatRemaining(59_001)).toBe('01:00');
    expect(formatRemaining(10 * 60_000)).toBe('10:00');
    expect(formatRemaining(3_599_999)).toBe('1:00:00');
    expect(formatRemaining(3_600_001)).toBe('1:00:01');
    expect(formatRemaining(2 * 3_600_000)).toBe('2:00:00');
  });
});
