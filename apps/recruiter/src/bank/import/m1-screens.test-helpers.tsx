// The import stream's entry in the M1 screen registry (src/m1-screen-registry.test-helpers.ts): synthetic-data renders
// of every state of the import screen, so tests/m1-guards.test.tsx applies D1's word lists to all of them. Only the
// import screens may say "download" or "CSV" (spec §6.9: the error list made in the browser).
import type { ReactNode } from 'react';
import { ImportView, type ImportHandlers, type Screen } from './ImportView';
import type { RunState } from './run';

const noop = () => undefined;
const handlers: ImportHandlers = {
  onFile: noop,
  onZip: noop,
  onCheck: noop,
  onStart: noop,
  onChooseAnother: noop,
  onTryAgain: noop,
  onFinish: noop,
  onCancel: noop,
  onDownloadErrors: noop,
  onDownloadTemplate: noop,
};

const run: RunState = {
  phase: 'ready',
  stage: null,
  jobId: '33333333-3333-4333-8333-333333333333',
  imagesDone: 3,
  imagesTotal: 3,
  rowsSent: 10,
  rowsTotal: 10,
  accepted: 9,
  issues: [
    { rowNo: 4, field: 'stem', code: 'missing_field' },
    { rowNo: 6, field: 'correct', code: 'bad_key' },
    { rowNo: 9, field: 'image_file', code: 'image_missing' },
  ],
  failure: null,
  job: null,
};
const job = {
  id: '33333333-3333-4333-8333-333333333333',
  workspaceId: '44444444-4444-4444-8444-444444444444',
  sourceKind: 'xlsx' as const,
  templateVersion: 'trace-items-v1' as const,
  status: 'completed' as const,
  rowsTotal: 10,
  rowsOk: 9,
  rowsError: 1,
  imagesOk: 3,
  createdAt: '2026-10-23T10:00:00.000Z',
  completedAt: '2026-10-23T10:05:00.000Z',
};
const onRun = (state: Partial<RunState>, sourceKind: 'xlsx' | 'docx' = 'xlsx'): Screen => ({
  kind: 'run',
  sourceKind,
  fileName: 'synthetic-items.xlsx',
  rowsRead: 12,
  state: { ...run, ...state },
});

const SCREENS: Record<string, Screen> = {
  'import choose': {
    kind: 'choose',
    fileName: null,
    zipName: null,
    checking: false,
    failure: null,
  },
  'import checking': {
    kind: 'choose',
    fileName: 'synthetic-items.xlsx',
    zipName: 'synthetic-images.zip',
    checking: true,
    failure: null,
  },
  'import refused': {
    kind: 'choose',
    fileName: 'synthetic-items.xlsm',
    zipName: null,
    checking: false,
    failure: 'macro_file',
  },
  'import checked': {
    kind: 'checked',
    sourceKind: 'xlsx',
    fileName: 'synthetic-items.xlsx',
    rowsRead: 12,
    rowsReady: 10,
    imagesInFile: 3,
    issues: run.issues,
  },
  'import checked docx': {
    kind: 'checked',
    sourceKind: 'docx',
    fileName: 'synthetic-items.docx',
    rowsRead: 4,
    rowsReady: 0,
    imagesInFile: 0,
    issues: [{ rowNo: 2, field: 'format', code: 'missing_field' }],
  },
  'import checked many problems': {
    kind: 'checked',
    sourceKind: 'xlsx',
    fileName: 'synthetic-items.xlsx',
    rowsRead: 260,
    rowsReady: 10,
    imagesInFile: 0,
    issues: Array.from({ length: 250 }, (_, i) => ({
      rowNo: i + 2,
      field: 'stem' as const,
      code: 'too_long' as const,
    })),
  },
  'import running': onRun({ phase: 'running', stage: 'rows', rowsSent: 4 }),
  'import ready': onRun({}),
  'import ready finish failed': onRun({ failure: 'conflict' }),
  'import completing': onRun({ phase: 'completing', stage: null }),
  'import cancelling': onRun({ phase: 'cancelling', stage: null }),
  'import stopped': onRun({ phase: 'stopped', stage: null, failure: 'network' }),
  'import completed': onRun({ phase: 'completed', job }),
  'import cancelled': onRun({ phase: 'cancelled', job: { ...job, status: 'cancelled' } }),
  'import failed': onRun({ phase: 'failed', failure: 'timeout' }),
};

export function m1Screens(): Record<string, ReactNode> {
  const out: Record<string, ReactNode> = {};
  for (const [name, screen] of Object.entries(SCREENS)) {
    out[name] = <ImportView screen={screen} handlers={handlers} />;
  }
  return out;
}
