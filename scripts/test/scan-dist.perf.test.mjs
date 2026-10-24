// AT-16 / S1.4 N11 performance case, split out of scan-dist.test.mjs (D1-LEAD-1, M1 spec §1.5, R5-16).
// The 3,000-file case writes 3,000 files and streams 3.6 MB through the real gitleaks stdin. Its cost on
// Windows is file I/O (writing and reading 3,000 files, which the on-access malware scan slows), not
// gitleaks: idle on the dev laptop (2026-10-23) gitleaks start-up was 0.2-0.3 s and the 3.6 MB stdin scan
// 0.6-0.7 s, but writing the files took 5.1 s and distText 3.1 s, and under load the case reached
// 87-104 s (D1 gates G4). So it runs where its bound means something: Linux (CI `static`). The bound is
// the scripts config's unchanged 60 s testTimeout; nothing was loosened. The functional N11 cases (one
// 400 KB line, short lines with no blank line) stay in scan-dist.test.mjs on every platform.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { distText } from '../scan-dist.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';
import { REPO_ROOT } from './fixtures/gitleaks-config.mjs';

afterEach(cleanupTempDirs);

const REPO_CONFIG = fileURLToPath(new URL('../../.gitleaks.toml', import.meta.url));

/** Every secret real gitleaks stdin reports for the distText stream of `rel` (unredacted). */
function stdinSecrets(root, rel) {
  const out = makeTempDir('trace-scan-report-');
  const report = `${out}/report.json`;
  const r = spawnSync(
    'gitleaks',
    [
      'stdin',
      '--no-banner',
      '--config',
      REPO_CONFIG,
      '--report-format',
      'json',
      '--report-path',
      report,
    ],
    { cwd: REPO_ROOT, input: distText(root, rel), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  expect(r.error).toBeUndefined();
  return new Set(JSON.parse(readFileSync(report, 'utf8')).map((f) => f.Secret));
}

/** A Supabase-secret-shaped key with no vowels, so no allowlist or stopword can drop it by chance. */
const denseKey = () =>
  [
    'sb',
    'secret',
    [...randomBytes(40)].map((b) => CONSONANTS[b % CONSONANTS.length]).join(''),
  ].join('_');
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz0123456789';

describe.skipIf(process.platform !== 'linux')(
  'distText through real gitleaks stdin, performance (Linux only: Windows file I/O under load makes the 60 s bound meaningless, D1-LEAD-1)',
  () => {
    it('finds every key in 3,000 single-line ~1.2 KB files', () => {
      const keys = [];
      const files = {};
      for (let i = 0; i < 3_000; i++) {
        const k = denseKey();
        keys.push(k);
        files[`d/assets/chunk-${String(i).padStart(4, '0')}.js`] =
          `${'a'.repeat(560)}x("${k}");${'b'.repeat(560)}`;
      }
      const root = makeTempDir();
      writeFiles(root, files);
      const found = stdinSecrets(root, 'd');
      expect(keys.filter((k) => !found.has(k)).length, 'keys gitleaks missed').toBe(0);
    });
  },
);
