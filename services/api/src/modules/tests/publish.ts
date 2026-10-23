// POST …/tests/:testId/publish (spec §6.2, L-9, L-15, OPEN-7; spec m1 §6.5, M1-12, R3-1, R5-56 d, R5-57 a, R5-60 e).
// The caller's role was checked before this runs (security review r3 #2). A version that uses no M1 feature publishes
// exactly as D1 (package v1, no digest). A v2 version: build the package from the live pool, write it to R2, then the
// guarded UPDATE with `content_sha256` and the `snapshot_digest` of the rows used; the guard writes
// section_pool_snapshot and refuses a digest of another snapshot with 40001 and the snapshot guard text, which alone is
// retried (rebuild each time, at most 3 retries, then 409). After the UPDATE the package is rebuilt from the frozen rows
// (the snapshot's item set) and compared; any difference retires the version (500, fail closed; the SessionDO verifies
// the hash too).
import { PublishTestRequest, PublishTestResponse } from '@trace/shared/contracts/d1';
import { sha256Hex } from '../candidate/encoding.js';
import {
  VERSION_COLS,
  VersionRowSchema,
  findRuleset,
  findTest,
  findVersion,
  loadContent,
  parseRows,
  type VersionRow,
} from './authoring.js';
import { answer } from './http.js';
import {
  RestError,
  isSnapshotConflict,
  orgFail,
  restErrorCode,
  type OrgContext,
} from './org-context.js';
import { buildPackage, encodePackage, packageKey } from './package.js';
import {
  buildPackageV2,
  digestOf,
  loadFrozenSource,
  loadLiveSource,
  usesM1,
  type PackageV2Problem,
} from './package-v2.js';

/** The R2 package bucket as the publish step uses it (`PACKAGES`, trace-packages-<env>). */
export interface PackageBucket {
  /** Writes the bytes; R2 checks the upload against `sha256`. */
  put(key: string, text: string, sha256: string): Promise<void>;
  getText(key: string): Promise<string | null>;
}

/** R5-56 d: at most 3 retries after the first attempt. */
export const MAX_SNAPSHOT_RETRIES = 3;

const cutoffValid = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;

const problemCode = (problem: PackageV2Problem) =>
  problem === 'pool_too_small'
    ? 'pool_too_small'
    : problem === 'too_large'
      ? 'package_too_large'
      : 'draft_incomplete';

/** The publish UPDATE's refusals: guard keys with their own code, any other guard refusal is draft_incomplete. */
const publishUpdateFailure = (err: unknown): never => {
  if (err instanceof RestError) {
    const code = restErrorCode(err);
    if (
      code === 'setting_locked' ||
      code === 'pool_too_small' ||
      code === 'package_too_large' ||
      (code === 'conflict' && err.guard !== null)
    ) {
      return orgFail(code);
    }
    // The guard refuses a draft that is not publishable (42501); the cutoff column is not null 0..100.
    if (err.sqlstate === '42501') return orgFail('draft_incomplete');
    if (err.sqlstate === '23514') return orgFail('cutoff_required');
  }
  throw err;
};

const retire = async (ctx: OrgContext, orgId: string, frozen: VersionRow): Promise<never> => {
  try {
    await ctx.rest.update(
      'test_versions',
      { id: `eq.${frozen.id}`, org_id: `eq.${orgId}`, status: 'eq.published', select: 'id' },
      { status: 'retired' },
    );
  } catch {
    // The 500 stands either way; the SessionDO's hash check also refuses a mismatched package.
  }
  return orgFail('internal');
};

/** The object must hold the frozen package; the frozen rows are the truth, so rewrite them when it differs. */
const ensureStored = async (bucket: PackageBucket, key: string, text: string, sha: string) => {
  const stored = await bucket.getText(key);
  if (stored === null || (await sha256Hex(stored)) !== sha) await bucket.put(key, text, sha);
};

const answerPublished = (frozen: VersionRow, sha: string) =>
  answer(PublishTestResponse, {
    testVersionId: frozen.id,
    versionNo: frozen.version_no,
    status: 'published',
    publishedAt: frozen.published_at,
    contentSha256: sha,
    qualityCutoff: frozen.quality_cutoff,
  });

export const publishDraft = async (
  ctx: OrgContext,
  orgId: string,
  testId: string,
  req: PublishTestRequest,
  bucket: PackageBucket,
): Promise<Response> => {
  if ((await findTest(ctx.rest, orgId, testId)) === null) return orgFail('not_found');
  // L-9: the id must be this test's open draft.
  const draft = await findVersion(ctx.rest, orgId, testId, req.testVersionId);
  if (draft?.status !== 'draft') return orgFail('conflict');
  if (!cutoffValid(draft.quality_cutoff)) return orgFail('cutoff_required');
  const content = await loadContent(ctx.rest, orgId, draft.id);
  const ruleset = await findRuleset(ctx.rest, orgId, draft.ruleset_version_id);
  if (usesM1(ruleset, content.sections, content.items)) {
    return await publishV2(ctx, orgId, testId, draft, bucket);
  }
  return await publishV1(ctx, orgId, testId, draft, bucket);
};

const publishV2 = async (
  ctx: OrgContext,
  orgId: string,
  testId: string,
  draft: VersionRow,
  bucket: PackageBucket,
): Promise<Response> => {
  const key = packageKey(draft.id);
  for (let attempt = 0; ; attempt += 1) {
    // Rebuilt from the live rows on every attempt (R5-56 d).
    const test = (await findTest(ctx.rest, orgId, testId)) ?? orgFail('not_found');
    const content = await loadContent(ctx.rest, orgId, draft.id);
    const ruleset = await findRuleset(ctx.rest, orgId, draft.ruleset_version_id);
    const live = await loadLiveSource(ctx.rest, orgId, content);
    const built = await buildPackageV2(test, draft, ruleset, live);
    if (!built.ok) return orgFail(problemCode(built.problem));
    try {
      await bucket.put(key, built.text, built.sha256);
    } catch {
      return orgFail('unavailable');
    }
    let published: unknown[];
    try {
      published = await ctx.rest.update(
        'test_versions',
        {
          id: `eq.${draft.id}`,
          org_id: `eq.${orgId}`,
          test_id: `eq.${testId}`,
          status: 'eq.draft',
          select: VERSION_COLS,
        },
        {
          status: 'published',
          content_sha256: built.sha256,
          snapshot_digest: await digestOf(built.rows),
        },
      );
    } catch (err) {
      // R5-60 e: only 40001 with the snapshot guard text is a retry.
      if (isSnapshotConflict(err)) {
        if (attempt < MAX_SNAPSHOT_RETRIES) continue;
        return orgFail('conflict');
      }
      return publishUpdateFailure(err);
    }
    const exposure = new Map(built.pkg.items.map((i) => [i.itemVersionId, i.exposureAtPublish]));
    const [frozen] = parseRows(VersionRowSchema, published);
    if (frozen === undefined) {
      // This attempt lost the race (spec review r3a #2). Its put may have landed after the winner's check: restore
      // the frozen package when this attempt's rebuild of the frozen rows matches the stored hash.
      try {
        const now = await findVersion(ctx.rest, orgId, testId, draft.id);
        if (now?.status === 'published' && now.content_sha256 !== null) {
          const again = await rebuildFrozen(ctx, orgId, testId, now, exposure);
          if (again?.ok === true && again.sha256 === now.content_sha256) {
            await ensureStored(bucket, key, again.text, again.sha256);
          }
        }
      } catch {
        // Best effort: the SessionDO's hash check still refuses a mismatched package.
      }
      return orgFail('conflict');
    }
    const again = await rebuildFrozen(ctx, orgId, testId, frozen, exposure);
    if (
      frozen.status !== 'published' ||
      frozen.content_sha256 !== built.sha256 ||
      again?.ok !== true ||
      again.sha256 !== built.sha256
    ) {
      return await retire(ctx, orgId, frozen);
    }
    try {
      await ensureStored(bucket, key, again.text, again.sha256);
    } catch {
      return await retire(ctx, orgId, frozen);
    }
    return answerPublished(frozen, built.sha256);
  }
};

/** The package rebuilt from the frozen version: the snapshot's item set, the built exposure counts. */
const rebuildFrozen = async (
  ctx: OrgContext,
  orgId: string,
  testId: string,
  frozen: VersionRow,
  exposure: ReadonlyMap<string, number>,
) => {
  const test = await findTest(ctx.rest, orgId, testId);
  if (test === null) return null;
  const content = await loadContent(ctx.rest, orgId, frozen.id);
  const ruleset = await findRuleset(ctx.rest, orgId, frozen.ruleset_version_id);
  const src = await loadFrozenSource(ctx.rest, orgId, frozen.id, content, exposure);
  return await buildPackageV2(test, frozen, ruleset, src);
};

/** D1's publish, unchanged (package v1; no snapshot, no digest). */
const publishV1 = async (
  ctx: OrgContext,
  orgId: string,
  testId: string,
  draft: VersionRow,
  bucket: PackageBucket,
): Promise<Response> => {
  const test = (await findTest(ctx.rest, orgId, testId)) ?? orgFail('not_found');
  const built = buildPackage(test, draft, await loadContent(ctx.rest, orgId, draft.id));
  if (!built.ok) return orgFail('draft_incomplete');
  const encoded = await encodePackage(built.pkg);
  const key = packageKey(draft.id);
  try {
    await bucket.put(key, encoded.text, encoded.sha256);
  } catch {
    return orgFail('unavailable');
  }

  let published: unknown[];
  try {
    published = await ctx.rest.update(
      'test_versions',
      {
        id: `eq.${draft.id}`,
        org_id: `eq.${orgId}`,
        test_id: `eq.${testId}`,
        status: 'eq.draft',
        select: VERSION_COLS,
      },
      { status: 'published', content_sha256: encoded.sha256 },
    );
  } catch (err) {
    return publishUpdateFailure(err);
  }
  const [frozen] = parseRows(VersionRowSchema, published);
  if (frozen === undefined) {
    // Spec review r3a #2: this attempt lost the race, but its put above may have landed after the winner's check and
    // overwritten the published package. Rewrite the bytes rebuilt from the frozen rows (identical from every writer)
    // when they match the stored hash; the answer stays 409 either way.
    try {
      const now = await findVersion(ctx.rest, orgId, testId, draft.id);
      if (now?.status === 'published' && now.content_sha256 !== null) {
        const frozenTest = await findTest(ctx.rest, orgId, testId);
        const rebuilt =
          frozenTest === null
            ? null
            : buildPackage(frozenTest, now, await loadContent(ctx.rest, orgId, now.id));
        const again = rebuilt?.ok === true ? await encodePackage(rebuilt.pkg) : null;
        if (again !== null && again.sha256 === now.content_sha256) {
          await ensureStored(bucket, key, again.text, again.sha256);
        }
      }
    } catch {
      // Best effort: the SessionDO's hash check still refuses a mismatched package (fail closed).
    }
    return orgFail('conflict');
  }

  // Rebuild from the frozen rows; any difference retires the version (fail closed).
  const frozenTest = await findTest(ctx.rest, orgId, testId);
  const rebuilt =
    frozenTest === null
      ? null
      : buildPackage(frozenTest, frozen, await loadContent(ctx.rest, orgId, frozen.id));
  const again = rebuilt?.ok === true ? await encodePackage(rebuilt.pkg) : null;
  if (
    frozen.status !== 'published' ||
    frozen.content_sha256 !== encoded.sha256 ||
    again === null ||
    again.sha256 !== encoded.sha256
  ) {
    return await retire(ctx, orgId, frozen);
  }
  try {
    await ensureStored(bucket, key, again.text, again.sha256);
  } catch {
    return await retire(ctx, orgId, frozen);
  }
  return answerPublished(frozen, encoded.sha256);
};
