#!/usr/bin/env node
// M0b candidate-token spike (specs/m0b-tenancy.md §8, Q6 -> ADR-030, Proposed).
//
// Part 1 mints an ES256 token with WebCrypto, verifies it with the exported PUBLIC key
// and shows that a tampered, an expired, an alg=none and a foreign-key token are rejected.
// Part 2 runs ONE rolled-back transaction on the shared local Supabase database and shows
// that, with SET LOCAL ROLE trace_candidate and request.jwt.claims taken from the VERIFIED
// token, a candidate-keyed RLS policy lets exactly one row through and denies the other.
//
// Safety: all data is synthetic; the private key is non-extractable and never printed or
// written; no full token is ever printed or passed to psql (only the verified claims JSON,
// through a psql variable); everything database-side is rolled back.
//
// Usage: node docs/spikes/m0b-candidate-token/spike.mjs
// Needs: Node 22, Docker, and the local stack container `supabase_db_trace` (lead-owned).

import { spawnSync } from 'node:child_process';

const { subtle } = globalThis.crypto;

const DB_CONTAINER = 'supabase_db_trace';
const DOCKER_TIMEOUT_MS = 60_000;

// Synthetic identifiers only (RFC 4122 v4 shaped, no real person or tenant).
const CANDIDATE_ID = '00000000-0000-4000-8000-0000000000c1';
const OTHER_CANDIDATE_ID = '00000000-0000-4000-8000-0000000000c2';
const INVITATION_ID = '00000000-0000-4000-8000-0000000000b1';
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';

const TOKEN_TYPES = ['lobby', 'session', 'portal'];
const CLAIM_KEYS = ['sub', 'candidate_id', 'invitation_id', 'org_id', 'typ', 'nonce', 'iat', 'exp'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOCK_SKEW_SECONDS = 60;

// The M0b tables of specs/m0b-tenancy.md §3. They are created by migrations that land in
// stream B0, so on a stack without them each one is reported as SKIPPED, never as passed.
const M0B_TABLES = [
  'orgs',
  'workspaces',
  'teams',
  'memberships',
  'audit_log',
  'platform_staff',
  'staff_access_grants',
  'idempotency_keys',
];

const results = { pass: 0, fail: 0, skipped: 0 };

function pass(name, detail = '') {
  results.pass += 1;
  console.log(`PASS: ${name}${detail ? ` (${detail})` : ''}`);
}
function fail(name, detail = '') {
  results.fail += 1;
  console.log(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
}
function skipped(name, detail = '') {
  results.skipped += 1;
  console.log(`SKIPPED: ${name}${detail ? ` (${detail})` : ''}`);
}
function check(ok, name, detail = '') {
  (ok ? pass : fail)(name, detail);
}
function finding(text) {
  console.log(`FINDING: ${text}`);
}

// ---------------------------------------------------------------------------------------
// Part 1: ES256 mint and verify with WebCrypto
// ---------------------------------------------------------------------------------------

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const encodeJson = (value) => b64url(Buffer.from(JSON.stringify(value)));
const decodeJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

const ES256 = { name: 'ECDSA', hash: 'SHA-256' };
const P256 = { name: 'ECDSA', namedCurve: 'P-256' };

async function jwkThumbprint(jwk) {
  // RFC 7638 thumbprint input for an EC key: members in lexicographic order.
  const input = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return b64url(await subtle.digest('SHA-256', Buffer.from(input)));
}

async function generateSigningKey() {
  // extractable = false: the private key can never be exported, so it cannot be printed.
  // (The public key of a WebCrypto key pair is always exportable.)
  const pair = await subtle.generateKey(P256, false, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  const kid = (await jwkThumbprint(jwk)).slice(0, 16);
  const publicJwk = {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    alg: 'ES256',
    use: 'sig',
    kid,
  };
  return { privateKey: pair.privateKey, publicJwk };
}

async function mintToken(privateKey, kid, payload, header = { alg: 'ES256', typ: 'JWT', kid }) {
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = await subtle.sign(ES256, privateKey, Buffer.from(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

function checkClaimShape(claims, expectedTyp) {
  // Mirrors the zod claim shape proposed in ADR-030 (strict: no unknown claims).
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    return 'claims_not_object';
  }
  const keys = Object.keys(claims).sort();
  if (keys.join(',') !== [...CLAIM_KEYS].sort().join(',')) return 'claim_keys_mismatch';
  for (const key of ['sub', 'candidate_id', 'invitation_id', 'org_id']) {
    if (typeof claims[key] !== 'string' || !UUID_RE.test(claims[key])) return `bad_${key}`;
  }
  if (claims.sub !== claims.candidate_id) return 'sub_not_candidate_id';
  if (!TOKEN_TYPES.includes(claims.typ)) return 'bad_typ';
  if (claims.typ !== expectedTyp) return 'wrong_token_type';
  if (typeof claims.nonce !== 'string' || claims.nonce.length < 16) return 'bad_nonce';
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return 'bad_times';
  return null;
}

/**
 * Edge-side verification: needs only the PUBLIC key. Order matters: header, signature,
 * then claims, so nothing in the payload is trusted before the signature checks out.
 */
async function verifyToken(token, publicKey, { now, expectedTyp }) {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerPart, payloadPart, signaturePart] = parts;
  let header;
  try {
    header = decodeJson(headerPart);
  } catch {
    return { ok: false, reason: 'malformed_header' };
  }
  if (header?.alg !== 'ES256' || header?.typ !== 'JWT') return { ok: false, reason: 'bad_alg' };
  const signature = Buffer.from(signaturePart, 'base64url');
  if (signature.length !== 64) return { ok: false, reason: 'bad_signature_length' };
  const valid = await subtle.verify(
    ES256,
    publicKey,
    signature,
    Buffer.from(`${headerPart}.${payloadPart}`),
  );
  if (!valid) return { ok: false, reason: 'bad_signature' };
  let claims;
  try {
    claims = decodeJson(payloadPart);
  } catch {
    return { ok: false, reason: 'malformed_payload' };
  }
  const shapeProblem = checkClaimShape(claims, expectedTyp);
  if (shapeProblem) return { ok: false, reason: shapeProblem };
  if (claims.exp <= now) return { ok: false, reason: 'expired' };
  if (claims.iat > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'issued_in_future' };
  return { ok: true, claims };
}

async function runTokenChecks() {
  console.log('== Part 1: ES256 token (WebCrypto, no library) ==');
  const now = Math.floor(Date.now() / 1000);
  const { privateKey, publicJwk } = await generateSigningKey();
  const nonce = b64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const claims = {
    sub: CANDIDATE_ID,
    candidate_id: CANDIDATE_ID,
    invitation_id: INVITATION_ID,
    org_id: ORG_ID,
    typ: 'session',
    nonce,
    iat: now,
    exp: now + 5400,
  };

  console.log(
    `key: ${publicJwk.kty} ${publicJwk.crv} alg=${publicJwk.alg} kid=${publicJwk.kid} ` +
      '(private key is non-extractable and is never printed)',
  );
  check(!('d' in publicJwk), 'exported JWK is public only', 'no "d" member');
  let privateExportRefused = false;
  try {
    await subtle.exportKey('jwk', privateKey);
  } catch {
    privateExportRefused = true;
  }
  check(privateExportRefused, 'private key cannot be exported', 'extractable = false');

  // The edge only ever holds the public JWK.
  const publicKey = await subtle.importKey('jwk', publicJwk, P256, false, ['verify']);
  const verifyOptions = { now, expectedTyp: 'session' };

  const token = await mintToken(privateKey, publicJwk.kid, claims);
  console.log(`minted: header.payload.signature, ${token.length} chars (token not printed)`);

  const good = await verifyToken(token, publicKey, verifyOptions);
  check(good.ok, 'valid token verifies with the public JWK', good.ok ? '' : good.reason);
  if (!good.ok) return null;
  console.log(`decoded claims: ${JSON.stringify(good.claims)}`);
  check(
    JSON.stringify(good.claims) === JSON.stringify(claims),
    'verified claims equal the minted claims',
  );

  // Tampered payload: same header and signature, different org_id.
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  const tamperedClaims = {
    ...decodeJson(payloadPart),
    org_id: '00000000-0000-4000-8000-0000000000a2',
  };
  const tampered = `${headerPart}.${encodeJson(tamperedClaims)}.${signaturePart}`;
  const tamperedResult = await verifyToken(tampered, publicKey, verifyOptions);
  check(
    !tamperedResult.ok && tamperedResult.reason === 'bad_signature',
    'tampered payload is rejected',
    tamperedResult.ok ? 'accepted' : tamperedResult.reason,
  );

  // Expired: correctly signed, exp in the past.
  const expiredToken = await mintToken(privateKey, publicJwk.kid, {
    ...claims,
    iat: now - 7200,
    exp: now - 10,
  });
  const expiredResult = await verifyToken(expiredToken, publicKey, verifyOptions);
  check(
    !expiredResult.ok && expiredResult.reason === 'expired',
    'expired token is rejected (signature itself is valid)',
    expiredResult.ok ? 'accepted' : expiredResult.reason,
  );

  // alg = none must never be accepted.
  const noneToken = `${encodeJson({ alg: 'none', typ: 'JWT' })}.${encodeJson(claims)}.`;
  const noneResult = await verifyToken(noneToken, publicKey, verifyOptions);
  check(
    !noneResult.ok && noneResult.reason === 'bad_alg',
    'alg=none token is rejected',
    noneResult.ok ? 'accepted' : noneResult.reason,
  );

  // Signed by another key: rejected.
  const foreign = await generateSigningKey();
  const foreignToken = await mintToken(foreign.privateKey, publicJwk.kid, claims);
  const foreignResult = await verifyToken(foreignToken, publicKey, verifyOptions);
  check(
    !foreignResult.ok && foreignResult.reason === 'bad_signature',
    'token signed by a different key is rejected',
    foreignResult.ok ? 'accepted' : foreignResult.reason,
  );

  // Wrong token type for the route (a portal token must not open a session route).
  const portalToken = await mintToken(privateKey, publicJwk.kid, { ...claims, typ: 'portal' });
  const portalResult = await verifyToken(portalToken, publicKey, verifyOptions);
  check(
    !portalResult.ok && portalResult.reason === 'wrong_token_type',
    'portal token is rejected on a session route',
    portalResult.ok ? 'accepted' : portalResult.reason,
  );

  return good.claims;
}

// ---------------------------------------------------------------------------------------
// Part 2: one rolled-back transaction on the local database
// ---------------------------------------------------------------------------------------

// Every value that varies (verified claims, other candidate, M0B table names) reaches SQL
// through psql variables (:'name'), never by string interpolation into this text.
const SPIKE_SQL = String.raw`
begin;

select 'FACT|role_pre_existing|' || exists (select from pg_roles where rolname = 'trace_candidate');

do $$
begin
  if not exists (select from pg_roles where rolname = 'trace_candidate') then
    create role trace_candidate nologin nobypassrls;
  end if;
end $$;

select 'FACT|role_attrs|' || concat_ws(',',
  'login=' || rolcanlogin, 'bypassrls=' || rolbypassrls, 'super=' || rolsuper,
  'createrole=' || rolcreaterole, 'createdb=' || rolcreatedb, 'replication=' || rolreplication)
from pg_roles where rolname = 'trace_candidate';

-- The throwaway table and its single candidate-keyed SELECT policy (spec section 8).
create table public.spike_cand (org_id uuid not null, candidate_id uuid not null, v text);
alter table public.spike_cand enable row level security;
create policy spike_cand_select on public.spike_cand for select to trace_candidate
  using (candidate_id = ((select auth.jwt()) ->> 'candidate_id')::uuid);
grant select on public.spike_cand to trace_candidate;

insert into public.spike_cand (org_id, candidate_id, v) values
  (((:'claims')::jsonb ->> 'org_id')::uuid, ((:'claims')::jsonb ->> 'candidate_id')::uuid,
   'row-for-token-candidate'),
  (((:'claims')::jsonb ->> 'org_id')::uuid, (:'other_candidate')::uuid,
   'row-for-other-candidate');
select 'FACT|rows_total_as_owner|' || count(*) from public.spike_cand;

-- The gateway stand-in: postgres may SET ROLE to trace_candidate, but does not inherit it.
grant trace_candidate to postgres with inherit false, set true;
select 'FACT|membership|' || coalesce(string_agg(
  'grantor=' || m.grantor::regrole || ' inherit=' || m.inherit_option || ' set=' || m.set_option,
  '; ' order by m.grantor::regrole::text), 'none')
from pg_auth_members m
where m.roleid = 'trace_candidate'::regrole and m.member = 'postgres'::regrole;

-- Test harness only (not a grant a candidate role needs): probes that catch the error
-- instead of aborting the transaction, so a refusal can be reported as a fact.
create function public.spike_probe_tbl(p_name text) returns text language plpgsql as $f$
declare n bigint;
begin
  if not exists (
    select from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relname = p_name and c.relkind in ('r', 'p')
  ) then
    return 'absent';
  end if;
  execute format('select count(*) from public.%I', p_name) into n;
  return 'rows=' || n;
exception when others then
  return 'refused sqlstate=' || sqlstate;
end $f$;

create function public.spike_probe_jwt() returns text language plpgsql as $f$
declare v text;
begin
  execute 'select auth.jwt() ->> ''candidate_id''' into v;
  return 'ok';
exception when others then
  return 'refused sqlstate=' || sqlstate;
end $f$;

grant execute on function public.spike_probe_tbl(text), public.spike_probe_jwt()
  to trace_candidate;

-- Discovery D1: which extra grants does evaluating auth.jwt() inside a policy need?
-- Nothing beyond the SELECT grant above and the PUBLIC defaults (EXECUTE on auth.jwt(),
-- USAGE on schema public). Recorded here by testing, not assumed.
select 'FACT|d_pre_auth_usage|' || has_schema_privilege('trace_candidate', 'auth', 'USAGE');
select 'FACT|d_pre_jwt_execute|' || has_function_privilege('trace_candidate', 'auth.jwt()', 'EXECUTE');
select 'FACT|d_pre_jwt_public_execute|' || exists (
  select from pg_proc p, aclexplode(p.proacl) a
  where p.oid = 'auth.jwt'::regproc and a.grantee = 0 and a.privilege_type = 'EXECUTE');
select 'FACT|d_pre_public_usage_on_public|' || has_schema_privilege('trace_candidate', 'public', 'USAGE');

savepoint d1;
set local role trace_candidate;
select 'FACT|d1_claims_set|' || (set_config('request.jwt.claims', :'claims', true) = :'claims');
select 'FACT|d1_policy_path_without_extra_grants|' || public.spike_probe_tbl('spike_cand');
select 'FACT|d1_direct_auth_jwt_call|' || public.spike_probe_jwt();
rollback to savepoint d1;

-- Discovery D2: can postgres (the migration owner) grant what a direct call would need?
-- postgres holds USAGE on schema auth and EXECUTE on auth.jwt() without grant option,
-- so these GRANTs are silent no-ops (a WARNING, not an error).
savepoint d2;
grant usage on schema auth to trace_candidate;
grant execute on function auth.jwt() to trace_candidate;
select 'FACT|d2_usage_auth_after_grant|' || has_schema_privilege('trace_candidate', 'auth', 'USAGE');
select 'FACT|d2_explicit_jwt_execute_acl_rows|' || count(*)
from pg_proc p, aclexplode(p.proacl) a
where p.oid = 'auth.jwt'::regproc and a.grantee = 'trace_candidate'::regrole;
set local role trace_candidate;
select 'FACT|d2_claims_set|' || (set_config('request.jwt.claims', :'claims', true) = :'claims');
select 'FACT|d2_direct_auth_jwt_call_after_grants|' || public.spike_probe_jwt();
rollback to savepoint d2;

-- Main test: no extra grants applied. SET LOCAL ROLE + claims from the verified token.
set local role trace_candidate;
select 'FACT|current_user|' || current_user;
select 'FACT|claims_set|' || (set_config('request.jwt.claims', :'claims', true) = :'claims');
select 'FACT|visible_total|' || count(*) from public.spike_cand;
select 'FACT|visible_own|' || count(*) from public.spike_cand where v = 'row-for-token-candidate';
select 'FACT|visible_other|' || count(*) from public.spike_cand where v = 'row-for-other-candidate';

-- Same role, the OTHER candidate's claims: the policy follows the claims, not a constant.
select 'FACT|swap_claims_set|' || (set_config('request.jwt.claims',
  jsonb_build_object('candidate_id', :'other_candidate')::text, true) is not null);
select 'FACT|swap_visible|' || coalesce(string_agg(v, ',' order by v), 'none') from public.spike_cand;

-- No claims at all: fail closed.
select 'FACT|empty_claims_set|' || (set_config('request.jwt.claims', '', true) = '');
select 'FACT|empty_claims_visible|' || count(*) from public.spike_cand;

-- M0b tables: restore the verified claims, then probe each one as trace_candidate.
select 'FACT|claims_restored|' || (set_config('request.jwt.claims', :'claims', true) = :'claims');
select 'FACT|m0b:' || t || '|' || public.spike_probe_tbl(t)
from unnest(string_to_array(:'m0b_tables', ',')) as t;

rollback;
`;

function runDocker(args, input) {
  return spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: DOCKER_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function containerRunning() {
  const result = runDocker(['ps', '--filter', `name=^${DB_CONTAINER}$`, '--format', '{{.Names}}']);
  return result.status === 0 && result.stdout.trim() === DB_CONTAINER;
}

function psql(extraArgs, sql) {
  return runDocker(
    [
      'exec',
      '-i',
      DB_CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      ...extraArgs,
    ],
    sql,
  );
}

function parseFacts(stdout) {
  const facts = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('FACT|')) continue;
    const rest = line.slice('FACT|'.length);
    const sep = rest.indexOf('|');
    facts.set(rest.slice(0, sep), rest.slice(sep + 1));
  }
  return facts;
}

function runDatabaseChecks(claims) {
  console.log('');
  console.log(
    '== Part 2: RLS under SET LOCAL ROLE trace_candidate (one rolled-back transaction) ==',
  );
  if (!containerRunning()) {
    fail(`local stack container ${DB_CONTAINER} is running`, 'start the local stack, then rerun');
    return;
  }

  const run = psql(
    [
      '-v',
      `claims=${JSON.stringify(claims)}`,
      '-v',
      `other_candidate=${OTHER_CANDIDATE_ID}`,
      '-v',
      `m0b_tables=${M0B_TABLES.join(',')}`,
    ],
    SPIKE_SQL,
  );
  if (run.error || run.status !== 0) {
    fail(
      'spike transaction ran',
      `psql exit ${run.status}${run.error ? `, ${run.error.message}` : ''}; stderr: ${run.stderr.trim().slice(0, 400)}`,
    );
    return;
  }
  const facts = parseFacts(run.stdout);
  const get = (key) => facts.get(key) ?? '(missing)';

  // Role.
  const attrs = get('role_attrs');
  check(
    attrs ===
      'login=false,bypassrls=false,super=false,createrole=false,createdb=false,replication=false',
    'trace_candidate is NOLOGIN, NOBYPASSRLS and holds no SUPERUSER/CREATEROLE/CREATEDB/REPLICATION',
    attrs,
  );
  finding(
    get('role_pre_existing') === 'true'
      ? 'trace_candidate already existed on this stack (reused as is)'
      : 'trace_candidate did not exist; the spike created it inside the transaction (rolled back)',
  );
  const membership = get('membership');
  check(
    /grantor=postgres inherit=false set=true/.test(membership),
    'postgres holds trace_candidate with inherit false, set true',
    membership,
  );
  check(
    get('rows_total_as_owner') === '2',
    'fixture holds two rows, one per candidate',
    `owner sees ${get('rows_total_as_owner')}`,
  );

  // Main RLS result.
  check(
    get('current_user') === 'trace_candidate',
    'SET LOCAL ROLE trace_candidate took effect',
    get('current_user'),
  );
  check(get('claims_set') === 'true', 'request.jwt.claims set from the verified token claims');
  check(
    get('visible_total') === '1' && get('visible_own') === '1' && get('visible_other') === '0',
    'RLS: exactly ONE row allowed (token candidate) and ONE denied (other candidate)',
    `visible total=${get('visible_total')} own=${get('visible_own')} other=${get('visible_other')}`,
  );
  check(
    get('swap_visible') === 'row-for-other-candidate',
    "RLS follows the claims: the other candidate's claims see only the other row",
    get('swap_visible'),
  );
  check(
    get('empty_claims_visible') === '0',
    'no claims: zero rows (fail closed)',
    `rows=${get('empty_claims_visible')}`,
  );

  // Discovery of extra grants (recorded for M3a).
  console.log('-- grant discovery (input for M3a) --');
  finding(
    `before any extra grant: USAGE on schema auth=${get('d_pre_auth_usage')}, EXECUTE on auth.jwt()=${get('d_pre_jwt_execute')} ` +
      `(via PUBLIC=${get('d_pre_jwt_public_execute')}), USAGE on schema public=${get('d_pre_public_usage_on_public')}`,
  );
  check(
    get('d1_policy_path_without_extra_grants') === 'rows=1',
    'auth.jwt() inside the policy evaluates with NO grant beyond SELECT on the table',
    get('d1_policy_path_without_extra_grants'),
  );
  finding(`a direct call of auth.jwt() by trace_candidate: ${get('d1_direct_auth_jwt_call')}`);
  const grantsWereNoOps =
    get('d2_usage_auth_after_grant') === 'false' && get('d2_explicit_jwt_execute_acl_rows') === '0';
  finding(
    `GRANT USAGE ON SCHEMA auth / EXECUTE ON auth.jwt() issued by postgres: USAGE afterwards=${get('d2_usage_auth_after_grant')}, ` +
      `explicit ACL rows for trace_candidate on auth.jwt()=${get('d2_explicit_jwt_execute_acl_rows')}` +
      (grantsWereNoOps ? ' (both grants were silent no-ops)' : ' (grants took effect)'),
  );
  finding(
    `direct call of auth.jwt() after those grants: ${get('d2_direct_auth_jwt_call_after_grants')}`,
  );

  // M0b tables.
  console.log('-- M0b tables as trace_candidate --');
  for (const table of M0B_TABLES) {
    const outcome = get(`m0b:${table}`);
    if (outcome === 'absent') {
      skipped(`M0b table ${table} not present yet`);
    } else if (outcome === 'rows=0' || outcome.startsWith('refused sqlstate=42501')) {
      pass(
        `trace_candidate on public.${table}`,
        outcome === 'rows=0' ? 'reads zero rows' : 'refused (42501)',
      );
    } else {
      fail(`trace_candidate on public.${table}`, outcome);
    }
  }

  // The transaction must have left nothing behind.
  const after = psql(
    [],
    `select 'FACT|table_left|' || (to_regclass('public.spike_cand') is not null);
select 'FACT|probe_left|' || (to_regprocedure('public.spike_probe_tbl(text)') is not null);
select 'FACT|role_left|' || exists (select from pg_roles where rolname = 'trace_candidate');`,
  );
  const afterFacts = parseFacts(after.stdout ?? '');
  const roleOk =
    afterFacts.get('role_left') === (get('role_pre_existing') === 'true' ? 'true' : 'false');
  check(
    after.status === 0 &&
      afterFacts.get('table_left') === 'false' &&
      afterFacts.get('probe_left') === 'false' &&
      roleOk,
    'rolled back: spike table, probe functions and the role created by the spike are gone',
  );
}

// ---------------------------------------------------------------------------------------

const verifiedClaims = await runTokenChecks();
if (verifiedClaims === null) {
  fail('token verified, so the database part cannot run');
} else {
  runDatabaseChecks(verifiedClaims);
}

console.log('');
console.log(`RESULT: ${results.pass} passed, ${results.fail} failed, ${results.skipped} skipped`);
process.exit(results.fail > 0 ? 1 : 0);
