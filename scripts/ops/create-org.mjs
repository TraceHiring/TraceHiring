#!/usr/bin/env node
// Operator script: create an org through private.create_org (specs/m0b-tenancy.md §2.6, §4.4).
//   node scripts/ops/create-org.mjs --name <n> --slug <s> --kind customer|trace_library|trace_internal \
//     --owner-user-id <uuid> --display-name <n> [--request-id <uuid>]
// The DB URL comes from env TRACE_OPERATOR_DB_URL (default: the local stack's, from `supabase status`)
// and is never printed. Arguments are validated with the CreateOrgArgs contract (a failure names the
// field only, exit 2) and reach SQL only as psql -v variables. Prints only the new org id.
import { CreateOrgArgs } from '../../packages/shared/src/contracts-tenancy.ts';
import { isEntryPoint } from '../lib/cli.mjs';
import {
  createOrg,
  describeFailure,
  line,
  parseFlags,
  realDeps,
  resolveDbUrl,
  validate,
} from './lib.mjs';

const TAG = 'create-org';
const OPTIONS = {
  name: { type: 'string' },
  slug: { type: 'string' },
  kind: { type: 'string' },
  'owner-user-id': { type: 'string' },
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
  const parsed = validate(CreateOrgArgs, {
    name: flags.name,
    slug: flags.slug,
    kind: flags.kind,
    ownerUserId: flags['owner-user-id'],
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
  const res = createOrg(parsed.data, url, deps);
  if (!res.ok) {
    line(deps.stderr, `${TAG}: ${describeFailure(res)}`);
    return 1;
  }
  line(deps.stdout, res.id);
  return 0;
}

if (isEntryPoint(import.meta.url)) process.exit(main({ argv: process.argv.slice(2) }));
