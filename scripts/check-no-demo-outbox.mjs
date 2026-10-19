#!/usr/bin/env node
// AT-D18 (specs/d1-demo-slice.md §5.3, §6.1; L-11): a production-flavour recruiter build contains no demo-outbox
// string. The recruiter includes the demo outbox (mock Messaging: invite links and OTPs) only when it is built
// with VITE_DEMO_OUTBOX=1 exactly and a VITE_TRACE_ENV of exactly dev or staging (e2e-local and the staging
// deploy; an allow-list, SEC-W2-1); every other build is production-flavour and is checked here, after
// `pnpm -r build`, including one that has the flag but VITE_TRACE_ENV unset, production, prod or any other value
// (the app's inline gate in routes.tsx must keep the outbox out of it). Every
// file under apps/recruiter/dist/ is read as text (js, css, html, source maps). Fails (exit 1) on any hit or when
// the dist folder is missing; a demo build is skipped with a notice.
// Optional argument: the repository root (default: this script's repo). Reads only VITE_DEMO_OUTBOX and
// VITE_TRACE_ENV.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/cli.mjs';

export const RECRUITER_DIST = 'apps/recruiter/dist';

/** The only VITE_TRACE_ENV values (with VITE_DEMO_OUTBOX=1) that build a demo outbox; mirrors routes.tsx. */
export const DEMO_TRACE_ENVS = Object.freeze(['dev', 'staging']);

/** demo-outbox, Demo outbox, DemoOutbox, DEMO_OUTBOX, demo_outbox, demoOutbox. */
export const DEMO_OUTBOX_PATTERN = /demo[-_ ]?outbox/i;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

/** Repo-relative paths (forward slashes) of the dist files that mention the demo outbox. */
export function findDemoOutbox(root) {
  const dist = path.join(root, RECRUITER_DIST);
  return walk(dist)
    .filter((file) => DEMO_OUTBOX_PATTERN.test(readFileSync(file, 'latin1')))
    .map((file) => path.relative(root, file).split(path.sep).join('/'));
}

/** { ok, skipped, hits, missing? } for one repository root and environment. */
export function runCheck({ root, env }) {
  // The same allow-list as the app's inline gate (apps/recruiter/src/routes.tsx).
  if (env.VITE_DEMO_OUTBOX === '1' && DEMO_TRACE_ENVS.includes(env.VITE_TRACE_ENV))
    return { ok: true, skipped: true, hits: [] };
  if (!existsSync(path.join(root, RECRUITER_DIST))) {
    return { ok: false, skipped: false, hits: [], missing: true };
  }
  const hits = findDemoOutbox(root);
  return { ok: hits.length === 0, skipped: false, hits };
}

if (isEntryPoint(import.meta.url)) {
  const root = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = runCheck({ root, env: process.env });
  if (result.skipped) {
    console.log(
      'check-no-demo-outbox: skipped (a VITE_DEMO_OUTBOX=1 demo build for dev or staging)',
    );
  } else if (result.missing === true) {
    console.error(
      `check-no-demo-outbox: ${RECRUITER_DIST} is missing; build the recruiter app first`,
    );
    process.exitCode = 1;
  } else if (!result.ok) {
    console.error(
      'check-no-demo-outbox: a production-flavour recruiter build mentions the demo outbox:',
    );
    for (const hit of result.hits) console.error(`  ${hit}`);
    process.exitCode = 1;
  } else {
    console.log('check-no-demo-outbox: OK');
  }
}
