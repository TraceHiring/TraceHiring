// Times on the drive screens (M2-8): shown and typed in IST (Asia/Kolkata), sent with an explicit +05:30 offset.
import { describe, expect, it } from 'vitest';
import { formatIst, istInputToIso, minutesToWords, offsetsSentence, parseSlotLine } from './time';

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
