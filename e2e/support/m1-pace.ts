// The human-pace clock and the measurement record of the M1 specs (specs/m1-test-authoring.md §1.6 R2-20, AT-M1-01,
// AT-M1-30, AT-M1-10).
//
// R2-20 pace model: 2 s per click, 1 s per field focus, typing at 40 words per minute (a word is 5 characters, so
// 200 characters a minute: 300 ms a character), and 10 s of reading per screen.
//
// How it is applied (stated once, here): the pace is a BUDGET ADDED to the measured time, not a real wait. A spec calls
// `click()`, `focus()`, `typed()` and `read()` where a person would do the same thing; each adds its modelled
// milliseconds to `modelledMs` and the browser then acts at machine speed. `elapsedMs() = measuredMs() + modelledMs`,
// where `measuredMs()` is the real wall-clock time from `start()` (every sign-in, page load, api call and wait is in
// it) minus the time spent inside `excluded()` (set-up a real recruiter would not do: the placeholder item bank). This
// is the conservative reading of "a person at this pace on this stack": the machine never overlaps a person's
// thinking time. Nothing in here waits.
//
// The record: `recordMeasurement` writes `<project output dir>/<name>.json` (like dc-d6.json and d1-manifest.json) and
// pushes one test annotation per number. Numbers and step names only: no email, password, token, id or body.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';

/** R2-20: 2 s a click. */
export const CLICK_MS = 2_000;
/** R2-20: 1 s to put the cursor in a field. */
export const FOCUS_MS = 1_000;
/** R2-20: 40 words a minute, 5 characters a word = 200 characters a minute = 300 ms a character. */
export const TYPING_WPM = 40;
export const CHARS_PER_WORD = 5;
export const TYPE_MS_PER_CHAR = 60_000 / (TYPING_WPM * CHARS_PER_WORD);
/** R2-20: 10 s of reading per screen. */
export const READ_MS = 10_000;

export interface PaceBreakdown {
  /** Real time from start() to now, minus the excluded set-up. */
  measured_ms: number;
  /** The modelled human time added. */
  modelled_ms: number;
  /** Real time spent in excluded() set-up, not counted. */
  excluded_ms: number;
  clicks: number;
  focuses: number;
  typed_chars: number;
  screens_read: number;
  /** measured_ms + modelled_ms. */
  elapsed_ms: number;
}

export class PaceClock {
  private startedAt: number | null = null;
  private excludedMs = 0;
  private modelledMs = 0;
  private clicks = 0;
  private focuses = 0;
  private typedChars = 0;
  private screens = 0;

  /** Starts the measured time (once). */
  start(): void {
    if (this.startedAt !== null) throw new Error('the pace clock is already running');
    this.startedAt = Date.now();
  }

  /** One click. */
  click(count = 1): void {
    this.clicks += count;
    this.modelledMs += CLICK_MS * count;
  }

  /** The cursor goes into one field. */
  focus(count = 1): void {
    this.focuses += count;
    this.modelledMs += FOCUS_MS * count;
  }

  /** `length` characters typed. Pass the length, never the text, so a secret is not kept here. */
  typed(length: number): void {
    this.typedChars += length;
    this.modelledMs += Math.round(length * TYPE_MS_PER_CHAR);
  }

  /** A new screen has appeared and a person reads it. */
  read(count = 1): void {
    this.screens += count;
    this.modelledMs += READ_MS * count;
  }

  /** Runs set-up that is not part of what is timed; the real time it takes is kept apart. */
  async excluded<T>(work: () => Promise<T>): Promise<T> {
    const from = Date.now();
    try {
      return await work();
    } finally {
      this.excludedMs += Date.now() - from;
    }
  }

  measuredMs(): number {
    if (this.startedAt === null) throw new Error('the pace clock was not started');
    return Date.now() - this.startedAt - this.excludedMs;
  }

  elapsedMs(): number {
    return this.measuredMs() + this.modelledMs;
  }

  breakdown(): PaceBreakdown {
    const measured = this.measuredMs();
    return {
      measured_ms: measured,
      modelled_ms: this.modelledMs,
      excluded_ms: this.excludedMs,
      clicks: this.clicks,
      focuses: this.focuses,
      typed_chars: this.typedChars,
      screens_read: this.screens,
      elapsed_ms: measured + this.modelledMs,
    };
  }
}

/**
 * Records a measurement: one test annotation per number (so the HTML report and the JSON reporter show it) and
 * `<project output dir>/<file>.json`. `file` is a fixed name like `m1-at01` (lower case, digits, dashes).
 */
export const recordMeasurement = (
  testInfo: TestInfo,
  file: string,
  facts: Readonly<Record<string, number | string | boolean>>,
): string => {
  if (!/^[a-z0-9-]{1,40}$/.test(file)) throw new Error('a measurement file name is [a-z0-9-]');
  for (const [type, value] of Object.entries(facts)) {
    testInfo.annotations.push({ type, description: String(value) });
  }
  const target = path.join(testInfo.project.outputDir, `${file}.json`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ spec: file, ...facts }, null, 2)}\n`);
  return target;
};
