// Slots as data (specs/m2-scheduling-invites.md §5 SlotsCreateRequest, §6.1, R5-52 d): the create form by generator or
// by list, checked here with a plain sentence per problem and then against the shared contract; and the slots a
// recruiter may move an invitation to (open, in the future, with a seat free).
import { SlotsCreateRequest, type SlotView } from '@trace/shared/contracts/m2';
import { driveErrorText } from './messages';
import { istInputToIso, parseSlotLine } from './time';

export type SlotHow = 'generator' | 'list';
export interface SlotForm {
  how: SlotHow;
  /** datetime-local, IST. */
  first: string;
  count: string;
  interval: string;
  seats: string;
  /** One slot per line: "2026-11-03 10:00" or "2026-11-03 10:00, 25". */
  lines: string;
}
export const EMPTY_SLOT_FORM: SlotForm = {
  how: 'generator',
  first: '',
  count: '',
  interval: '',
  seats: '',
  lines: '',
};

const WHOLE = /^\d{1,9}$/;
const whole = (text: string, min: number, max: number): number | null => {
  const value = text.trim();
  if (!WHOLE.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
};
const SEATS_PROBLEM = 'Seats per slot must be a whole number from 1 to 20,000.';

export type SlotFormResult =
  { ok: true; request: SlotsCreateRequest } | { ok: false; problems: string[] };

export function buildSlotsRequest(form: SlotForm): SlotFormResult {
  const problems: string[] = [];
  const seats = whole(form.seats, 1, 20000);

  if (form.how === 'generator') {
    const first = form.first === '' ? null : istInputToIso(form.first);
    if (form.first === '') problems.push('Enter the time of the first slot.');
    else if (first === null) problems.push('The time of the first slot is not a valid time.');
    const count = whole(form.count, 1, 500);
    if (count === null) problems.push('The number of slots must be a whole number from 1 to 500.');
    const interval = whole(form.interval, 15, 1440);
    if (interval === null) {
      problems.push('The minutes between slots must be a whole number from 15 to 1440.');
    }
    if (seats === null) problems.push(SEATS_PROBLEM);
    if (
      problems.length > 0 ||
      first === null ||
      count === null ||
      interval === null ||
      seats === null
    ) {
      return { ok: false, problems };
    }
    return finish({
      generator: { firstStartsAt: first, count, intervalMinutes: interval, capacity: seats },
    });
  }

  const lines = form.lines.split(/\r?\n/);
  const slots: { startsAt: string; capacity: number }[] = [];
  let needsDefault = false;
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const parsed = parseSlotLine(line);
    if (parsed === null) {
      problems.push(`Line ${String(index + 1)} is not a time.`);
      continue;
    }
    if (parsed.seats === null) needsDefault = true;
    slots.push({ startsAt: parsed.startsAt, capacity: parsed.seats ?? seats ?? 0 });
  }
  if (problems.length === 0 && slots.length === 0) problems.push('Enter at least one slot time.');
  if (slots.length > 500) problems.push('Add at most 500 slots at a time.');
  if (needsDefault && seats === null) problems.push(SEATS_PROBLEM);
  if (problems.length > 0) return { ok: false, problems };
  return finish({ slots });
}

function finish(candidate: unknown): SlotFormResult {
  const parsed = SlotsCreateRequest.safeParse(candidate);
  return parsed.success
    ? { ok: true, request: parsed.data }
    : { ok: false, problems: [driveErrorText('bad_request')] };
}

/**
 * The slots an invitation may be moved to: open, starting after `now`, with a seat free, and not its own slot.
 * Earlier slots come first.
 */
export function movableSlots(
  slots: readonly SlotView[],
  currentStartsAt: string | undefined,
  now: number,
): SlotView[] {
  const current = currentStartsAt === undefined ? NaN : Date.parse(currentStartsAt);
  return slots
    .filter(
      (slot) =>
        slot.status === 'open' &&
        slot.booked < slot.capacity &&
        Date.parse(slot.startsAt) > now &&
        Date.parse(slot.startsAt) !== current,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
