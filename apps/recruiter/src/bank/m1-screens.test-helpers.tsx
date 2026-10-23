// Synthetic-data renders of the bank screens for tests/m1-guards.test.tsx (AT-M1-24), by name. See
// src/m1-screen-registry.test-helpers.ts. The route modules themselves are rendered by the guard file.
import type { ReactNode } from 'react';
import { AiDraftFormView, AiJobView } from './AiDraftsRoute';
import { ApprovalQueueTable } from './ApprovalsRoute';
import { BankTable, StatsPanel } from './BankRoute';
import { FilterForm } from './FilterForm';
import { ItemContentView } from './ItemContentView';
import { ItemFormView } from './ItemFormView';
import { NewPoolForm, PoolTable } from './PoolsRoute';
import { ReviewPanel } from './ReviewPanel';
import { EMPTY_FILTERS } from './filters';
import { formFromDetail, toDraft } from './item-form';
import { EMPTY_AI_FORM } from './ai-draft-form';
import {
  PARAM_SPEC,
  STATS,
  aiJob,
  mcqDetail,
  pool,
  summary,
  writtenDetail,
} from './testing/fixtures.test-helpers';

const noop = () => undefined;

const specDetail = mcqDetail(
  5,
  { status: 'in_review', isParameterised: true },
  { paramSpec: PARAM_SPEC },
);
const specForm = { ...formFromDetail(specDetail) };
specForm.spec = { ...specForm.spec, count: '3', stem: '' };
const specErrors = (() => {
  const result = toDraft(specForm);
  return result.ok ? [] : result.errors;
})();
const libraryCopy = (() => {
  const base = mcqDetail(8, { status: 'approved', origin: 'library', librarySourced: true });
  const content = { ...base.content } as Record<string, unknown>;
  delete content['key'];
  return { ...base, content } as typeof base;
})();

export function m1Screens(): Record<string, ReactNode> {
  return {
    'bank table': (
      <BankTable
        rows={[
          summary(1),
          summary(2, { status: 'in_review', origin: 'ai_draft' }),
          summary(3, { format: 'written', difficulty: null, isParameterised: true }),
        ]}
      />
    ),
    'item content': (
      <ItemContentView detail={mcqDetail(1, { status: 'approved', exposureCount: 4 })} />
    ),
    'item content ai draft': (
      <ItemContentView detail={mcqDetail(2, { status: 'in_review', origin: 'ai_draft' })} />
    ),
    'item content parameterised': <ItemContentView detail={specDetail} />,
    'item content written': <ItemContentView detail={writtenDetail(3, { status: 'approved' })} />,
    'item content library': <ItemContentView detail={libraryCopy} />,
    'item review': (
      <ReviewPanel
        detail={mcqDetail(2, { status: 'in_review' })}
        userId={mcqDetail(2).createdBy}
        busy={false}
        error="conflict"
        onDecide={noop}
      />
    ),
    'item form': (
      <ItemFormView
        form={formFromDetail(mcqDetail(1))}
        errors={[{ path: 'stem', message: 'Write the question (1 to 4000 characters).' }]}
        formatLocked={false}
        onChange={noop}
      />
    ),
    'item form parameter spec': (
      <ItemFormView form={specForm} errors={specErrors} formatLocked onChange={noop} />
    ),
    'approval queue': (
      <ApprovalQueueTable
        rows={[
          summary(1, { status: 'in_review' }),
          summary(2, { status: 'in_review', origin: 'ai_draft' }),
        ]}
        openId={null}
        onOpen={noop}
      />
    ),
    'approval queue empty': <ApprovalQueueTable rows={[]} openId={null} onOpen={noop} />,
    'ai draft form': (
      <AiDraftFormView
        form={EMPTY_AI_FORM}
        errors={[{ path: 'topic', message: 'Describe the topic (1 to 500 characters).' }]}
        busy={false}
        failure="rate_limited"
        onChange={noop}
        onSubmit={noop}
      />
    ),
    'ai draft job queued': <AiJobView job={aiJob()} />,
    'ai draft job completed': <AiJobView job={aiJob({ status: 'completed', draftsCreated: 2 })} />,
    'ai draft job failed': <AiJobView job={aiJob({ status: 'failed', errorCode: 'bad_output' })} />,
    'pool table': (
      <PoolTable
        pools={[
          pool(1, { usedByDraws: [{ testId: pool(9).id, drawCount: 3 }], usedByDrawsTotal: 8 }),
          pool(2, { format: 'written', skillKey: null, status: 'archived' }),
        ]}
        openId={null}
        onManage={noop}
      />
    ),
    'pool new': <NewPoolForm busy={false} failure="bad_request" onCreate={noop} />,
    'bank share': <StatsPanel stats={STATS} />,
    'bank filters': (
      <FilterForm
        kind="bank"
        value={EMPTY_FILTERS}
        error="Difficulty must be a number from 0 to 1."
        onChange={noop}
        onApply={noop}
        onReset={noop}
      />
    ),
  };
}
