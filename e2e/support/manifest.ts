// The D1 slice manifest (specs/d1-demo-slice.md §7.2 "Recorded measurements", AT-D2, AT-D17):
// `e2e/test-results/d1-manifest.json` with the commit SHA, the run id, the project, per-step milliseconds, the whole
// duration and `time_to_ready_ms` per candidate. Nothing secret goes in: no email, password, token, link, code or id
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
  steps: StepTiming[];
  timeToReadyMs: Record<string, number>;
}

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
  steps: [],
  timeToReadyMs: {},
});

/** Writes the manifest next to the other run facts (the project's output folder). */
export const writeManifest = (outputDir: string, manifest: Manifest): string => {
  const file = path.join(outputDir, 'd1-manifest.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
};
