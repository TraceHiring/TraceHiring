#!/usr/bin/env node
// Operator script: add a member through private.add_member (specs/m0b-tenancy.md §2.6, §4.4).
//   node scripts/ops/add-member.mjs --org-id <uuid> --user-id <uuid> --roles recruiter[,reviewer,...] \
//     --display-name <n> [--request-id <uuid>]
// Same URL handling, validation (AddMemberArgs: a failure names the field only, exit 2) and psql -v
// variables as create-org.mjs. The membership is always `active`. Prints only the membership id.
import { AddMemberArgs } from '../../packages/shared/src/contracts-tenancy.ts';
import { isEntryPoint } from '../lib/cli.mjs';
import {
  addMember,
  describeFailure,
  line,
  parseFlags,
  realDeps,
  resolveDbUrl,
  validate,
} from './lib.mjs';

const TAG = 'add-member';
const OPTIONS = {
  'org-id': { type: 'string' },
  'user-id': { type: 'string' },
  roles: { type: 'string' },
  'display-name': { type: 'string' },
  'request-id': { type: 'string' },
};

/** Returns the exit code: 0 ok, 1 failure, 2 bad arguments. */
export function main({ argv, deps = realDeps() }) {
  let flags;
  try {
    flags = parseFlags(argv, OPTIONS);
  } catch {
    line(deps.stderr, `${TAG}: unknown or malformed argument`);
    return 2;
  }
  const parsed = validate(AddMemberArgs, {
    orgId: flags['org-id'],
    userId: flags['user-id'],
    roles: flags.roles === undefined ? undefined : flags.roles.split(','),
    displayName: flags['display-name'],
    requestId: flags['request-id'] ?? deps.randomUUID(),
  });
  if (!parsed.ok) {
    line(deps.stderr, `${TAG}: invalid argument(s): ${parsed.fields.join(', ')}`);
    return 2;
  }
  const url = resolveDbUrl(deps);
  if (!url) {
    line(
      deps.stderr,
      `${TAG}: no database: set TRACE_OPERATOR_DB_URL or start the local stack (pnpm exec supabase start)`,
    );
    return 1;
  }
  const res = addMember(parsed.data, url, deps);
  if (!res.ok) {
    line(deps.stderr, `${TAG}: ${describeFailure(res)}`);
    return 1;
  }
  line(deps.stdout, res.id);
  return 0;
}

if (isEntryPoint(import.meta.url)) process.exit(main({ argv: process.argv.slice(2) }));
