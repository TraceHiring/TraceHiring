// Sections on the test screen (specs/m1-test-authoring.md §4.6, R5-9, R5-20, R5-66 b): a pure model of the view.
// The server decides every state and deadline; this only says what the screen may open. A v1 (D1) view is one or more
// free, open sections without deadlines or paste rules, so it navigates exactly as D1.
//   - not_entered: never opened, never requested (the DO opens it);
//   - closed (by the server, or locally while the screen moves on): read-only, never requested;
//   - open + free: any position;
//   - open + forward_only: only the highest position served so far, or the one after it (the DO refuses the rest).
import { isV2, type AnyView } from '../api';

export type SectionState = 'not_entered' | 'open' | 'closed';

export interface SectionInfo {
  id: string;
  title: string;
  /** 0-based, in section order. */
  index: number;
  navigation: 'free' | 'forward_only';
  pasteRule?: 'blocked' | 'allowed_logged';
  state: SectionState;
  /** The section's deadline on the server clock (v2 timed versions only). */
  deadlineAtMs?: number;
  /** Its positions, ascending. */
  positions: number[];
}

export interface Layout {
  v2: boolean;
  sections: SectionInfo[];
  /** Every position, ascending. */
  positions: number[];
  sectionOf: Map<number, SectionInfo>;
}

/** The model of a view; `closedHere` are sections this screen already treats as closed (deadline passed, finished). */
export const layoutOf = (view: AnyView, closedHere: ReadonlySet<string> = new Set()): Layout => {
  const v2 = isV2(view);
  const ordered = [...view.sections].sort((a, b) => a.position - b.position);
  const sections: SectionInfo[] = ordered.map((s, index) => {
    const positions = view.items
      .filter((i) => i.sectionId === s.id)
      .map((i) => i.position)
      .sort((a, b) => a - b);
    if (!('format' in s)) {
      return { id: s.id, title: s.title, index, navigation: 'free', state: 'open', positions };
    }
    const state: SectionState = closedHere.has(s.id) && s.state === 'open' ? 'closed' : s.state;
    return {
      id: s.id,
      title: s.title,
      index,
      navigation: s.navigation,
      ...(s.pasteRule === undefined ? {} : { pasteRule: s.pasteRule }),
      state,
      ...(s.deadlineAt === undefined ? {} : { deadlineAtMs: Date.parse(s.deadlineAt) }),
      positions,
    };
  });
  const sectionOf = new Map<number, SectionInfo>();
  for (const s of sections) for (const p of s.positions) sectionOf.set(p, s);
  const positions = view.items.map((i) => i.position).sort((a, b) => a - b);
  return { v2, sections, positions, sectionOf };
};

/** The positions served so far: the view's `servedAt` plus those this screen loaded. */
export const servedOf = (view: AnyView, loaded: Iterable<number>): Set<number> => {
  const served = new Set(loaded);
  for (const i of view.items) if (i.servedAt !== null) served.add(i.position);
  return served;
};

/** The highest served position of a section, or null. */
export const highestServed = (section: SectionInfo, served: ReadonlySet<number>): number | null => {
  let highest: number | null = null;
  for (const p of section.positions) if (served.has(p)) highest = p;
  return highest;
};

/** The one or two positions a forward-only section may serve: the highest served and the next. */
const forwardTargets = (section: SectionInfo, served: ReadonlySet<number>): number[] => {
  const h = highestServed(section, served);
  if (h === null) return section.positions.slice(0, 1);
  const k = section.positions.indexOf(h);
  return section.positions.slice(k, k + 2);
};

/** Whether the screen may show this position (a closed section is shown read-only). */
export const canOpen = (layout: Layout, position: number, served: ReadonlySet<number>): boolean => {
  const section = layout.sectionOf.get(position);
  if (section === undefined || section.state === 'not_entered') return false;
  if (section.state === 'closed' || section.navigation === 'free') return true;
  return forwardTargets(section, served).includes(position);
};

/** Whether an item at this position may be requested from the edge now. */
export const mayRequest = (layout: Layout, position: number, served: ReadonlySet<number>) =>
  layout.sectionOf.get(position)?.state === 'open' && canOpen(layout, position, served);

/** Whether the answer at this position may change: its section is open and, forward-only, it is the latest one. */
export const isEditable = (layout: Layout, position: number, served: ReadonlySet<number>) => {
  const section = layout.sectionOf.get(position);
  if (section?.state !== 'open') return false;
  return section.navigation === 'free' || highestServed(section, served) === position;
};

/** Where an open section starts (or resumes): its first position, or, forward-only, its highest served one. */
const entryOf = (section: SectionInfo, served: ReadonlySet<number>): number | undefined =>
  section.navigation === 'forward_only'
    ? (highestServed(section, served) ?? section.positions[0])
    : section.positions[0];

/**
 * The position to show: `current` while it can still be shown in an open section, else the entry of the first open
 * section from the current one on, else of any open section, else `current` (or the first position).
 */
export const positionAfter = (
  layout: Layout,
  current: number | null,
  served: ReadonlySet<number>,
): number => {
  const fallback = current ?? layout.positions[0] ?? 1;
  const here = current === null ? undefined : layout.sectionOf.get(current);
  if (current !== null && here?.state === 'open' && canOpen(layout, current, served))
    return current;
  const from = here?.index ?? 0;
  const open = layout.sections.filter((s) => s.state === 'open' && s.positions.length > 0);
  const next = open.find((s) => s.index >= from) ?? open[0];
  return next === undefined ? fallback : (entryOf(next, served) ?? fallback);
};

/** The earliest deadline among open sections (server clock), or null. */
export const nextSectionDeadline = (layout: Layout): number | null => {
  let soonest: number | null = null;
  for (const s of layout.sections) {
    if (s.state !== 'open' || s.deadlineAtMs === undefined) continue;
    if (soonest === null || s.deadlineAtMs < soonest) soonest = s.deadlineAtMs;
  }
  return soonest;
};
