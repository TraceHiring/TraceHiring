// Times on the drive screens (M2-8): shown and typed in IST (Asia/Kolkata), sent with an explicit +05:30 offset.
import { describe, expect, it } from 'vitest';
import {
  formatIst,
  istInputToIso,
  minutesToWords,
  offsetsSentence,
  parseSlotLine,
  reminderPlan,
} from './time';

describe('formatIst', () => {
  it('shows an instant as the wall clock in India, 24 hours, with "IST"', () => {
    expect(formatIst('2026-11-02T04:30:00.000Z')).toBe('2 Nov 2026, 10:00 IST');
    expect(formatIst('2026-12-31T20:00:00.000Z')).toBe('1 Jan 2027, 01:30 IST');
    expect(formatIst('2026-11-02T10:00:00+05:30')).toBe('2 Nov 2026, 10:00 IST');
  });
  it('returns the text itself when it is not a time', () => {
    expect(formatIst('soon')).toBe('soon');
  });
});

describe('istInputToIso', () => {
  it('reads a datetime-local value as IST', () => {
    expect(istInputToIso('2026-11-02T10:00')).toBe('2026-11-02T10:00:00+05:30');
    expect(istInputToIso('2026-11-02T10:00:30')).toBe('2026-11-02T10:00:30+05:30');
  });
  it('refuses anything else, including dates that do not exist', () => {
    for (const bad of [
      '',
      '2026-11-02',
      '2026-11-02 10:00',
      '2026-02-31T10:00',
      '2026-11-02T25:00',
      'x',
    ]) {
      expect(istInputToIso(bad), bad).toBeNull();
    }
  });
});

describe('parseSlotLine', () => {
  it('reads "date time" and "date time, seats"', () => {
    expect(parseSlotLine('2026-11-03 10:00')).toEqual({
      startsAt: '2026-11-03T10:00:00+05:30',
      seats: null,
    });
    expect(parseSlotLine(' 2026-11-03T14:30 , 25 ')).toEqual({
      startsAt: '2026-11-03T14:30:00+05:30',
      seats: 25,
    });
  });
  it('refuses a line that is not a time or has bad seats', () => {
    expect(parseSlotLine('tomorrow')).toBeNull();
    expect(parseSlotLine('2026-11-03 10:00, many')).toBeNull();
    expect(parseSlotLine('2026-11-03 10:00, 0')).toBeNull();
  });
});

describe('reminders in words', () => {
  it('uses hours up to two days, days for whole days beyond, minutes otherwise', () => {
    expect(minutesToWords(1440)).toBe('24 hours');
    expect(minutesToWords(60)).toBe('1 hour');
    expect(minutesToWords(45)).toBe('45 minutes');
    expect(minutesToWords(15)).toBe('15 minutes');
    expect(minutesToWords(4320)).toBe('3 days');
    expect(minutesToWords(10080)).toBe('7 days');
    expect(minutesToWords(90)).toBe('90 minutes');
  });
  it('makes a sentence for the start or the deadline, longest first', () => {
    expect(offsetsSentence([60, 1440], 'start')).toBe('24 hours and 1 hour before the start');
    expect(offsetsSentence([4320, 1440, 60], 'deadline')).toBe(
      '3 days, 24 hours and 1 hour before the deadline',
    );
    expect(offsetsSentence([], 'start')).toBe('none');
  });
});

describe('reminderPlan (§6.1, M2-13, E8)', () => {
  const NOW = Date.parse('2026-11-01T00:00:00.000Z');

  it('puts each reminder at the slot start minus its offset, longest first, in IST', () => {
    // A slot at 10:00 IST on 3 Nov with offsets 24 h and 1 h: 10:00 the day before, and 09:00.
    const plan = reminderPlan('2026-11-03T04:30:00.000Z', [60, 1440], NOW);
    expect(plan).toEqual([
      { offsetMinutes: 1440, at: '2026-11-02T04:30:00.000Z', skipped: false },
      { offsetMinutes: 60, at: '2026-11-03T03:30:00.000Z', skipped: false },
    ]);
    expect(plan.map((p) => formatIst(p.at))).toEqual([
      '2 Nov 2026, 10:00 IST',
      '3 Nov 2026, 09:00 IST',
    ]);
  });

  it('marks a reminder whose time has already gone by as skipped (E8: late invite)', () => {
    // A slot at 16:00 IST on 1 Nov, seen at 05:30 IST that day: the 24 h one is in the past, the 1 h one is not.
    const plan = reminderPlan('2026-11-01T10:30:00.000Z', [1440, 60], NOW);
    expect(plan.map((p) => p.skipped)).toEqual([true, false]);
    expect(formatIst(plan[1]?.at ?? '')).toBe('1 Nov 2026, 15:00 IST');
  });

  it('is empty for no offsets, and for a start that is not a time', () => {
    expect(reminderPlan('2026-11-03T04:30:00.000Z', [], NOW)).toEqual([]);
    expect(reminderPlan('soon', [60], NOW)).toEqual([]);
  });
});
