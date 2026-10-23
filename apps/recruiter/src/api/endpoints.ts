// Typed calls for the D1 org endpoints (specs/d1-demo-slice.md §6.2) and, below them, the M1 authoring endpoints
// (specs/m1-test-authoring.md §6.11). Each one names its request and response contract from
// @trace/shared/contracts/d1 or /m1. The demo outbox call lives in outbox/ so that a production build,
// which drops that module, holds no trace of its path (AT-D18).
import {
  AssignmentListResponse,
  CreateInvitationResponse,
  InvitationListResponse,
  PublishTestResponse,
  ResultsListResponse,
  ReviewQueueResponse,
  TestDetailResponse,
  TestListResponse,
  type CreateAssignmentRequest,
  type CreateInvitationRequest,
  type CreateTestRequest,
  type UpdateTestDraftRequest,
} from '@trace/shared/contracts/d1';
import {
  AiDraftJobView,
  AiDraftRequest,
  ApproveItemRequest,
  BankItemCreateResponse,
  BankItemDetail,
  BankItemDraft,
  BankItemListQuery,
  BankItemListResponse,
  BankStatsResponse,
  BlueprintProposeRequest,
  BlueprintProposeResponse,
  CreateTestFromTemplateRequest,
  CreateTestFromTemplateResponse,
  ImportImagePutResponse,
  ImportJobCreateRequest,
  ImportJobCreateResponse,
  ImportJobView,
  ImportRowsRequest,
  ImportRowsResponse,
  IntegrityLockCreateRequest,
  IntegrityLockListResponse,
  IntegrityLockView,
  IntegritySettingsRequest,
  IntegritySettingsView,
  LibraryBrowseQuery,
  LibraryBrowseResponse,
  LibraryCopyRequest,
  LibraryCopyResponse,
  MemberInviteCreateResponse,
  MemberInviteListQuery,
  MemberInviteListResponse,
  MemberInviteRequest,
  MemberInviteView,
  PoolDetail,
  PoolItemsRequest,
  PoolListQuery,
  PoolListResponse,
  PoolRequest,
  RoleTemplateListQuery,
  RoleTemplateListResponse,
  SaveTestDraftRequest,
  SettingKey,
  TestDraftView,
} from '@trace/shared/contracts/m1';
import type { ApiClient, ApiResult, CallOptions, ImportImageType } from './client';

const id = (value: string): string => encodeURIComponent(value);

export const listTests = (api: ApiClient): Promise<ApiResult<TestListResponse>> =>
  api.call({ method: 'GET', path: '/tests', schema: TestListResponse });

export const createTest = (
  api: ApiClient,
  body: CreateTestRequest,
): Promise<ApiResult<TestDetailResponse>> =>
  api.call({ method: 'POST', path: '/tests', schema: TestDetailResponse, body });

export const getTest = (api: ApiClient, testId: string): Promise<ApiResult<TestDetailResponse>> =>
  api.call({ method: 'GET', path: `/tests/${id(testId)}`, schema: TestDetailResponse });

export const updateDraft = (
  api: ApiClient,
  testId: string,
  body: UpdateTestDraftRequest,
): Promise<ApiResult<TestDetailResponse>> =>
  api.call({ method: 'PUT', path: `/tests/${id(testId)}`, schema: TestDetailResponse, body });

export const publishTest = (
  api: ApiClient,
  testId: string,
  testVersionId: string,
): Promise<ApiResult<PublishTestResponse>> =>
  api.call({
    method: 'POST',
    path: `/tests/${id(testId)}/publish`,
    schema: PublishTestResponse,
    body: { testVersionId },
  });

export const listAssignments = (
  api: ApiClient,
  testId: string,
): Promise<ApiResult<AssignmentListResponse>> =>
  api.call({
    method: 'GET',
    path: `/tests/${id(testId)}/assignments`,
    schema: AssignmentListResponse,
  });

export const createAssignment = (
  api: ApiClient,
  testId: string,
  body: CreateAssignmentRequest,
): Promise<ApiResult<AssignmentListResponse>> =>
  api.call({
    method: 'POST',
    path: `/tests/${id(testId)}/assignments`,
    schema: AssignmentListResponse,
    body,
  });

export const deleteAssignment = (
  api: ApiClient,
  testId: string,
  assignmentId: string,
): Promise<ApiResult<AssignmentListResponse>> =>
  api.call({
    method: 'DELETE',
    path: `/tests/${id(testId)}/assignments/${id(assignmentId)}`,
    schema: AssignmentListResponse,
  });

export const listInvitations = (
  api: ApiClient,
  testId: string,
): Promise<ApiResult<InvitationListResponse>> =>
  api.call({
    method: 'GET',
    path: `/tests/${id(testId)}/invitations`,
    schema: InvitationListResponse,
  });

export const createInvitation = (
  api: ApiClient,
  testId: string,
  body: CreateInvitationRequest,
): Promise<ApiResult<CreateInvitationResponse>> =>
  api.call({
    method: 'POST',
    path: `/tests/${id(testId)}/invitations`,
    schema: CreateInvitationResponse,
    body,
  });

export const testResults = (
  api: ApiClient,
  testId: string,
): Promise<ApiResult<ResultsListResponse>> =>
  api.call({ method: 'GET', path: `/tests/${id(testId)}/results`, schema: ResultsListResponse });

export const reviewQueue = (api: ApiClient): Promise<ApiResult<ReviewQueueResponse>> =>
  api.call({ method: 'GET', path: '/review/reports', schema: ReviewQueueResponse });

// ---- M1 (specs/m1-test-authoring.md §6.11; answer shapes fixed by R5-53 c and R5-54 a) ---------------------------
// Every request is checked against its contract before it is sent (a failure is `bad_request`, no request is made);
// every answer is parsed by `ApiClient.call` with its response contract (a failure is `invalid_response`).

type Schema<T> = CallOptions<T>['schema'];
/** What the request check needs of a contract. */
interface Validator {
  safeParse(data: unknown): { success: boolean };
}
/** The wire form of a contract: for a query string that is text (a difficulty is decimal text). */
type WireInput<S extends { _zod: { input: unknown } }> = S['_zod']['input'];
type Query = Record<string, string | undefined>;

const refused = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, code: 'bad_request' });

/** A body-carrying call: the body is validated first and sent as given. */
function send<T>(
  api: ApiClient,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  request: Validator,
  body: unknown,
  schema: Schema<T>,
): Promise<ApiResult<T>> {
  if (!request.safeParse(body).success) return refused<T>();
  return api.call({ method, path, schema, body });
}

/** `?a=1&b=2` in key order, or '' for none; null when the query fails its contract. */
function queryString(request: Validator, query: Query | undefined): string | null {
  if (query === undefined) return '';
  if (!request.safeParse(query).success) return null;
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value !== undefined) params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

function list<T>(
  api: ApiClient,
  path: string,
  request: Validator,
  query: Query | undefined,
  schema: Schema<T>,
): Promise<ApiResult<T>> {
  const suffix = queryString(request, query);
  if (suffix === null) return refused<T>();
  return api.call({ method: 'GET', path: `${path}${suffix}`, schema });
}

/** A 204 with no body (R5-53 c): anything in the body is an `invalid_response`. */
const NoContent: Schema<undefined> = {
  safeParse: (data) =>
    data === undefined ? { success: true, data: undefined } : { success: false },
};

/** The answer of `DELETE …/members/invites/:inviteId`: the invite, now cancelled (R5-53 c). */
const CancelledInvite: Schema<MemberInviteView> = {
  safeParse: (data) => {
    const parsed = MemberInviteView.safeParse(data);
    return parsed.success && parsed.data.status === 'cancelled'
      ? { success: true, data: parsed.data }
      : { success: false };
  },
};

// -- Bank items (§6.2) --------------------------------------------------------------------------------------------

export const listBankItems = (
  api: ApiClient,
  query?: WireInput<typeof BankItemListQuery>,
): Promise<ApiResult<BankItemListResponse>> =>
  list(api, '/bank/items', BankItemListQuery, query, BankItemListResponse);

export const createBankItem = (
  api: ApiClient,
  body: BankItemDraft,
): Promise<ApiResult<BankItemCreateResponse>> =>
  send(api, 'POST', '/bank/items', BankItemDraft, body, BankItemCreateResponse);

export const getBankItem = (api: ApiClient, itemId: string): Promise<ApiResult<BankItemDetail>> =>
  api.call({ method: 'GET', path: `/bank/items/${id(itemId)}`, schema: BankItemDetail });

/** Edits the item's draft version (draft only; the api refuses anything else). */
export const updateBankItem = (
  api: ApiClient,
  itemId: string,
  body: BankItemDraft,
): Promise<ApiResult<BankItemDetail>> =>
  send(api, 'PUT', `/bank/items/${id(itemId)}`, BankItemDraft, body, BankItemDetail);

/** A new draft version cloned from the item's latest (`POST …/bank/items/:itemId/versions`). */
export const createBankItemVersion = (
  api: ApiClient,
  itemId: string,
): Promise<ApiResult<BankItemCreateResponse>> =>
  api.call({
    method: 'POST',
    path: `/bank/items/${id(itemId)}/versions`,
    schema: BankItemCreateResponse,
  });

export const submitBankItemVersion = (
  api: ApiClient,
  itemVersionId: string,
): Promise<ApiResult<BankItemDetail>> =>
  api.call({
    method: 'POST',
    path: `/bank/item-versions/${id(itemVersionId)}/submit`,
    schema: BankItemDetail,
  });

/** Approve or send back (R5-22). The path id is the body's `itemVersionId`, so the two can never differ. */
export const reviewBankItemVersion = (
  api: ApiClient,
  body: ApproveItemRequest,
): Promise<ApiResult<BankItemDetail>> => {
  if (!ApproveItemRequest.safeParse(body).success) return refused();
  return api.call({
    method: 'POST',
    path: `/bank/item-versions/${id(body.itemVersionId)}/review`,
    schema: BankItemDetail,
    body,
  });
};

export const retireBankItemVersion = (
  api: ApiClient,
  itemVersionId: string,
): Promise<ApiResult<BankItemDetail>> =>
  api.call({
    method: 'POST',
    path: `/bank/item-versions/${id(itemVersionId)}/retire`,
    schema: BankItemDetail,
  });

export const bankStats = (api: ApiClient): Promise<ApiResult<BankStatsResponse>> =>
  api.call({ method: 'GET', path: '/bank/stats', schema: BankStatsResponse });

// -- Pools (§6.5) -------------------------------------------------------------------------------------------------

export const listPools = (
  api: ApiClient,
  query?: WireInput<typeof PoolListQuery>,
): Promise<ApiResult<PoolListResponse>> =>
  list(api, '/pools', PoolListQuery, query, PoolListResponse);

export const getPool = (api: ApiClient, poolId: string): Promise<ApiResult<PoolDetail>> =>
  api.call({ method: 'GET', path: `/pools/${id(poolId)}`, schema: PoolDetail });

export const createPool = (api: ApiClient, body: PoolRequest): Promise<ApiResult<PoolDetail>> =>
  send(api, 'POST', '/pools', PoolRequest, body, PoolDetail);

export const updatePool = (
  api: ApiClient,
  poolId: string,
  body: PoolRequest,
): Promise<ApiResult<PoolDetail>> =>
  send(api, 'PUT', `/pools/${id(poolId)}`, PoolRequest, body, PoolDetail);

export const addPoolItems = (
  api: ApiClient,
  poolId: string,
  body: PoolItemsRequest,
): Promise<ApiResult<PoolDetail>> =>
  send(api, 'POST', `/pools/${id(poolId)}/items`, PoolItemsRequest, body, PoolDetail);

export const removePoolItems = (
  api: ApiClient,
  poolId: string,
  body: PoolItemsRequest,
): Promise<ApiResult<PoolDetail>> =>
  send(api, 'DELETE', `/pools/${id(poolId)}/items`, PoolItemsRequest, body, PoolDetail);

// -- Library (§6.2; rate-limited by the api) -----------------------------------------------------------------------

export const browseLibrary = (
  api: ApiClient,
  query?: WireInput<typeof LibraryBrowseQuery>,
): Promise<ApiResult<LibraryBrowseResponse>> =>
  list(api, '/library/items', LibraryBrowseQuery, query, LibraryBrowseResponse);

export const copyLibraryItems = (
  api: ApiClient,
  body: LibraryCopyRequest,
): Promise<ApiResult<LibraryCopyResponse>> =>
  send(api, 'POST', '/library/copy', LibraryCopyRequest, body, LibraryCopyResponse);

// -- AI drafts (§6.4) ---------------------------------------------------------------------------------------------

export const createAiDraftJob = (
  api: ApiClient,
  body: AiDraftRequest,
): Promise<ApiResult<AiDraftJobView>> =>
  send(api, 'POST', '/bank/ai-drafts', AiDraftRequest, body, AiDraftJobView);

export const getAiDraftJob = (api: ApiClient, jobId: string): Promise<ApiResult<AiDraftJobView>> =>
  api.call({ method: 'GET', path: `/bank/ai-drafts/${id(jobId)}`, schema: AiDraftJobView });

// -- Import (§6.9) ------------------------------------------------------------------------------------------------

export const createImportJob = (
  api: ApiClient,
  body: ImportJobCreateRequest,
): Promise<ApiResult<ImportJobCreateResponse>> =>
  send(api, 'POST', '/imports', ImportJobCreateRequest, body, ImportJobCreateResponse);

export const getImportJob = (api: ApiClient, jobId: string): Promise<ApiResult<ImportJobView>> =>
  api.call({ method: 'GET', path: `/imports/${id(jobId)}`, schema: ImportJobView });

/** One batch of 1 to 100 rows; the answer lists every bad row of the batch (row, column, code; never a cell). */
export const postImportRows = (
  api: ApiClient,
  jobId: string,
  body: ImportRowsRequest,
): Promise<ApiResult<ImportRowsResponse>> =>
  send(api, 'POST', `/imports/${id(jobId)}/rows`, ImportRowsRequest, body, ImportRowsResponse);

export const completeImportJob = (
  api: ApiClient,
  jobId: string,
): Promise<ApiResult<ImportJobView>> =>
  api.call({ method: 'POST', path: `/imports/${id(jobId)}/complete`, schema: ImportJobView });

export const cancelImportJob = (api: ApiClient, jobId: string): Promise<ApiResult<ImportJobView>> =>
  api.call({ method: 'POST', path: `/imports/${id(jobId)}/cancel`, schema: ImportJobView });

/** `PUT …/imports/:id/images/:sha256` (R5-18): the raw bytes of one image, content-addressed by their SHA-256. */
export const putImportImage = (
  api: ApiClient,
  jobId: string,
  sha256: string,
  contentType: ImportImageType,
  bytes: Uint8Array<ArrayBuffer> | ArrayBuffer | Blob,
): Promise<ApiResult<ImportImagePutResponse>> => {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return refused();
  return api.putImage({
    path: `/imports/${id(jobId)}/images/${sha256}`,
    schema: ImportImagePutResponse,
    contentType,
    bytes,
  });
};

// -- Integrity settings and admin locks (§6.6) -----------------------------------------------------------------------

export const getIntegritySettings = (
  api: ApiClient,
  testId: string,
): Promise<ApiResult<IntegritySettingsView>> =>
  api.call({
    method: 'GET',
    path: `/tests/${id(testId)}/integrity`,
    schema: IntegritySettingsView,
  });

export const putIntegritySettings = (
  api: ApiClient,
  testId: string,
  body: IntegritySettingsRequest,
): Promise<ApiResult<IntegritySettingsView>> =>
  send(
    api,
    'PUT',
    `/tests/${id(testId)}/integrity`,
    IntegritySettingsRequest,
    body,
    IntegritySettingsView,
  );

export const listIntegrityLocks = (api: ApiClient): Promise<ApiResult<IntegrityLockListResponse>> =>
  api.call({
    method: 'GET',
    path: '/settings/integrity-locks',
    schema: IntegrityLockListResponse,
  });

export const createIntegrityLock = (
  api: ApiClient,
  body: IntegrityLockCreateRequest,
): Promise<ApiResult<IntegrityLockView>> =>
  send(
    api,
    'POST',
    '/settings/integrity-locks',
    IntegrityLockCreateRequest,
    body,
    IntegrityLockView,
  );

/** Answers 204 with no body (R5-53 c). */
export const deleteIntegrityLock = (
  api: ApiClient,
  settingKey: SettingKey,
): Promise<ApiResult<undefined>> => {
  if (!SettingKey.safeParse(settingKey).success) return refused();
  return api.call({
    method: 'DELETE',
    path: `/settings/integrity-locks/${id(settingKey)}`,
    schema: NoContent,
  });
};

// -- Member invitations (§4.5) --------------------------------------------------------------------------------------

export const listMemberInvites = (
  api: ApiClient,
  query?: WireInput<typeof MemberInviteListQuery>,
): Promise<ApiResult<MemberInviteListResponse>> =>
  list(api, '/members/invites', MemberInviteListQuery, query, MemberInviteListResponse);

export const createMemberInvite = (
  api: ApiClient,
  body: MemberInviteRequest,
): Promise<ApiResult<MemberInviteCreateResponse>> =>
  send(api, 'POST', '/members/invites', MemberInviteRequest, body, MemberInviteCreateResponse);

/** Cancels a pending invite; the api answers the invite with status `cancelled` (R5-53 c). */
export const cancelMemberInvite = (
  api: ApiClient,
  inviteId: string,
): Promise<ApiResult<MemberInviteView>> =>
  api.call({
    method: 'DELETE',
    path: `/members/invites/${id(inviteId)}`,
    schema: CancelledInvite,
  });

// -- Templates and the test draft (§6.1, §6.5) ------------------------------------------------------------------------

export const listRoleTemplates = (
  api: ApiClient,
  query?: WireInput<typeof RoleTemplateListQuery>,
): Promise<ApiResult<RoleTemplateListResponse>> =>
  list(api, '/templates', RoleTemplateListQuery, query, RoleTemplateListResponse);

export const proposeBlueprint = (
  api: ApiClient,
  body: BlueprintProposeRequest,
): Promise<ApiResult<BlueprintProposeResponse>> =>
  send(api, 'POST', '/blueprints/propose', BlueprintProposeRequest, body, BlueprintProposeResponse);

export const createTestFromTemplate = (
  api: ApiClient,
  body: CreateTestFromTemplateRequest,
): Promise<ApiResult<CreateTestFromTemplateResponse>> =>
  send(
    api,
    'POST',
    '/tests/from-template',
    CreateTestFromTemplateRequest,
    body,
    CreateTestFromTemplateResponse,
  );

/**
 * `GET …/tests/:testId` as the M1 draft read-model (R5-53 a). Until A2 switches the api over (together with the
 * editor's load and save), the live route still answers D1's `TestDetailResponse`, which this does not parse; D1's
 * editor keeps using `getTest` and `updateDraft`.
 */
export const getTestDraft = (api: ApiClient, testId: string): Promise<ApiResult<TestDraftView>> =>
  api.call({ method: 'GET', path: `/tests/${id(testId)}`, schema: TestDraftView });

/** Clones the published version into a new draft (`POST …/tests/:testId/versions`, 201 `TestDraftView`). */
export const createTestVersion = (
  api: ApiClient,
  testId: string,
): Promise<ApiResult<TestDraftView>> =>
  api.call({ method: 'POST', path: `/tests/${id(testId)}/versions`, schema: TestDraftView });

export const saveTestDraft = (
  api: ApiClient,
  testId: string,
  body: SaveTestDraftRequest,
): Promise<ApiResult<TestDraftView>> =>
  send(api, 'PUT', `/tests/${id(testId)}/draft`, SaveTestDraftRequest, body, TestDraftView);
