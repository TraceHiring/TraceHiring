// Save and publish for the editor. Publish never reaches the api without a valid cutoff (specs/d1-demo-slice.md
// §6.1; the api also refuses it with 422 `cutoff_required`).
import type { PublishTestResponse, TestDetailResponse } from '@trace/shared/contracts/d1';
import type { ApiClient, ApiResult } from '../api/client';
import { publishTest, updateDraft } from '../api/endpoints';
import { isCutoffValid, toRequest, type DraftForm } from './editor-model';

export async function saveDraft(
  api: ApiClient,
  testId: string,
  form: DraftForm,
): Promise<ApiResult<TestDetailResponse>> {
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
