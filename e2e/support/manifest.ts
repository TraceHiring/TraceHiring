// The D1 slice manifest (specs/d1-demo-slice.md §7.2 "Recorded measurements", AT-D2, AT-D17):
// `e2e/test-results/d1-manifest.json` with the commit SHA, the run id, the project, per-step milliseconds, the whole
// duration, the recorded span (`recordedMs`, AT-D2), `time_to_ready_ms` per candidate and the CI run id. Nothing secret goes in: no email, password, token, link, code or id
// of a person, only step names and numbers.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface StepTiming {
  name: string;
  ms: number;
  ok: boolean;
}

export interface Manifest {
  spec: 'd1-slice';
  project: string;
  sha: string;
  runId: string;
  record: boolean;
  startedAt: string;
  durationMs: number | null;
  /**
   * AT-D2 (§7.3, D1-SPEC-2): ms from the first recorded browser context opened to the last context closed, the span
   * the OS-level screen capture covers; null when no recorded context was opened. `pnpm e2e:record` requires
   * 270 000-330 000.
   */
  recordedMs: number | null;
  steps: StepTiming[];
  /** AT-D17, named as in spec §7.2: ms from each candidate's own submit until both of its cards were ready. */
  time_to_ready_ms: Record<string, number>;
  /** The GitHub Actions run id (GITHUB_RUN_ID) when the run is a CI job, else null. */
  ciRunId: string | null;
}

/** GITHUB_RUN_ID when it is a run id (digits), else null. */
const ciRunId = (): string | null => {
  const value = process.env['GITHUB_RUN_ID'];
  return value !== undefined && /^[0-9]{1,20}$/.test(value) ? value : null;
};

/** `E2E_SHA`, else `git rev-parse HEAD` of this checkout, else `unknown`. */
export const commitSha = (): string => {
  const fromEnv = process.env['E2E_SHA'];
  if (fromEnv !== undefined && /^[0-9a-f]{7,40}$/.test(fromEnv)) return fromEnv;
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  const sha = String(r.stdout ?? '').trim();
  return r.status === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : 'unknown';
};

export const newManifest = (project: string, runId: string, record: boolean): Manifest => ({
  spec: 'd1-slice',
  project,
  sha: commitSha(),
  runId,
  record,
  startedAt: new Date().toISOString(),
  durationMs: null,
  recordedMs: null,
  steps: [],
  time_to_ready_ms: {},
  ciRunId: ciRunId(),
});

/** Writes the manifest next to the other run facts (the project's output folder). */
export const writeManifest = (outputDir: string, manifest: Manifest): string => {
  const file = path.join(outputDir, 'd1-manifest.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
};
