// Times on the drive screens (specs/m2-scheduling-invites.md M2-8): shown as the wall clock in India (Asia/Kolkata,
// en-IN), typed as IST, and sent with an explicit +05:30 offset. Small, deterministic helpers; no locale surprises.

const IST_OFFSET = '+05:30';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** An ISO time as "2 Nov 2026, 10:00 IST"; the input text when it is not a date. */
export function formatIst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = IST.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const month = MONTHS[Number(part('month')) - 1] ?? part('month');
  const hour = part('hour') === '24' ? '00' : part('hour');
  return `${part('day')} ${month} ${part('year')}, ${hour}:${part('minute')} IST`;
}

/** True for a real calendar date and clock time. */
function validParts(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const OFFSET_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i;

/** `YYYY-MM-DDTHH:mm[:ss]` (a datetime-local value) read as IST; null when it is not a real time. */
export function istInputToIso(value: string): string | null {
  if (!value.includes('T')) return null;
  return readLocal(value);
}

function readLocal(value: string): string | null {
  const m = LOCAL_TIME.exec(value);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (!validParts(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? '0'))) {
    return null;
  }
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${IST_OFFSET}`;
}

/**
 * A slot time from a file or a list: with an offset ("2026-11-03T10:00:00+05:30", "…Z") as it is, without one as IST
 * ("2026-11-03 10:00"). Null when it is not a real time.
 */
export function parseSlotValue(raw: string): string | null {
  const value = raw.trim();
  const withOffset = OFFSET_TIME.exec(value);
  if (withOffset !== null) {
    const [, y, mo, d, h, mi, s, zone] = withOffset;
    if (!validParts(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? '0'))) {
      return null;
    }
    if (zone !== undefined && zone.toUpperCase() !== 'Z') {
      const hours = Number(zone.slice(1, 3));
      const minutes = Number(zone.slice(4, 6));
      if (hours > 23 || minutes > 59) return null;
    }
    return `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${(zone ?? '').toUpperCase()}`;
  }
  return readLocal(value);
}

/** One line of the slot list: "2026-11-03 10:00" or "2026-11-03 10:00, 25" (seats). Null when it cannot be read. */
export function parseSlotLine(line: string): { startsAt: string; seats: number | null } | null {
  const pieces = line.split(',');
  if (pieces.length > 2) return null;
  const startsAt = parseSlotValue(pieces[0] ?? '');
  if (startsAt === null) return null;
  if (pieces.length === 1) return { startsAt, seats: null };
  const seatsText = (pieces[1] ?? '').trim();
  if (!/^\d{1,5}$/.test(seatsText)) return null;
  const seats = Number(seatsText);
  return seats >= 1 && seats <= 20000 ? { startsAt, seats } : null;
}

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? '' : 's'}`;

/** A reminder offset in words: hours up to two days, whole days beyond, otherwise minutes. */
export function minutesToWords(minutes: number): string {
  if (minutes % 60 === 0 && minutes <= 2880) return plural(minutes / 60, 'hour');
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

/** "24 hours and 1 hour before the start" (longest first); "none" for no reminders. */
export function offsetsSentence(offsets: readonly number[], anchor: 'start' | 'deadline'): string {
  if (offsets.length === 0) return 'none';
  const words = [...offsets].sort((a, b) => b - a).map(minutesToWords);
  const last = words.at(-1) ?? '';
  const list = words.length === 1 ? last : `${words.slice(0, -1).join(', ')} and ${last}`;
  return `${list} before the ${anchor}`;
}

export interface PlannedReminder {
  offsetMinutes: number;
  /** When the reminder would go, as an ISO instant. */
  at: string;
  /** True when that time is already past: the reminder is not sent (M2-13, E8). */
  skipped: boolean;
}

/**
 * The reminder plan of one slot as the page shows it (§6.1, M2-13): slot start minus each offset, longest first; a
 * time at or before `nowMs` is skipped. Display only: the server plans and sends the real reminders.
 */
export function reminderPlan(
  startsAt: string,
  offsetsMinutes: readonly number[],
  nowMs: number,
): PlannedReminder[] {
  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) return [];
  return [...offsetsMinutes]
    .sort((a, b) => b - a)
    .map((offsetMinutes) => {
      const at = start - offsetMinutes * 60_000;
      return { offsetMinutes, at: new Date(at).toISOString(), skipped: at <= nowMs };
    });
}
