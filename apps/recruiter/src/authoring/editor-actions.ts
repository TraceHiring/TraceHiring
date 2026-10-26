// Save and publish for the editor. Publish never reaches the api without a valid cutoff (specs/d1-demo-slice.md
// §6.1; the api also refuses it with 422 `cutoff_required`). A D1-shaped draft saves with D1's `PUT /tests/:testId`; a
// v2 draft with `PUT …/tests/:testId/draft` (specs/m1-test-authoring.md R5-69 b).
import type { PublishTestResponse } from '@trace/shared/contracts/d1';
import type { TestDraftView } from '@trace/shared/contracts/m1';
import type { ApiClient, ApiResult } from '../api/client';
import { createTestVersion, publishTest, saveTestDraft, updateDraft } from '../api/endpoints';
import { isCutoffValid, toRequest, type DraftForm } from './editor-model';
import { toSaveTestDraftRequest, type EditorV2Form } from './editor-v2-model';

export async function saveDraft(
  api: ApiClient,
  testId: string,
  form: DraftForm,
): Promise<ApiResult<TestDraftView>> {
  const built = toRequest(form);
  if (!built.ok) {
    return { ok: false, code: built.reason === 'cutoff' ? 'cutoff_required' : 'bad_request' };
  }
  return updateDraft(api, testId, built.request);
}

export async function publishDraft(
  api: ApiClient,
  testId: string,
  testVersionId: string,
  form: DraftForm,
): Promise<ApiResult<PublishTestResponse>> {
  if (!isCutoffValid(form.qualityCutoff)) return { ok: false, code: 'cutoff_required' };
  const saved = await saveDraft(api, testId, form);
  if (!saved.ok) return saved;
  return publishTest(api, testId, testVersionId);
}

// ---- v2 drafts (specs/m1-test-authoring.md R5-69 b) ----------------------------------------------------------------

/** Saves a v2 draft with `PUT …/tests/:testId/draft` (never built without a valid cutoff and a valid body). */
export async function saveDraftV2(
  api: ApiClient,
  form: EditorV2Form,
): Promise<ApiResult<TestDraftView>> {
  const built = toSaveTestDraftRequest(form);
  if (!built.ok) {
    return { ok: false, code: built.reason === 'cutoff' ? 'cutoff_required' : 'bad_request' };
  }
  return saveTestDraft(api, form.testId, built.request);
}

/**
 * Publishes a v2 draft: saves it first, so the published version is what the screen shows, then publishes that
 * version. A save refused because the version was published meanwhile (409 `conflict`, the frozen version) stops
 * here: nothing is published.
 */
export async function publishDraftV2(
  api: ApiClient,
  form: EditorV2Form,
): Promise<ApiResult<PublishTestResponse>> {
  if (!isCutoffValid(form.qualityCutoff)) return { ok: false, code: 'cutoff_required' };
  const saved = await saveDraftV2(api, form);
  if (!saved.ok) return saved;
  return publishTest(api, form.testId, form.versionId);
}

/** "Edit as new version" (R5-69 g): a new draft cloned from the published version; 409 when a draft is already open. */
export const editAsNewVersion = (
  api: ApiClient,
  testId: string,
): Promise<ApiResult<TestDraftView>> => createTestVersion(api, testId);
