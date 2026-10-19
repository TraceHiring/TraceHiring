// Typed calls for the D1 org endpoints (specs/d1-demo-slice.md §6.2). Each one names its request and response
// contract from @trace/shared/contracts/d1. The demo outbox call lives in outbox/ so that a production build,
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
import type { ApiClient, ApiResult } from './client';

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
