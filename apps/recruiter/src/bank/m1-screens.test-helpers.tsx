// Synthetic-data renders of the bank screens for tests/m1-guards.test.tsx (AT-M1-24), by name. See
// src/m1-screen-registry.test-helpers.ts. The route modules themselves are rendered by the guard file.
import type { ReactNode } from 'react';
import { BankTable, StatsPanel } from './BankRoute';
import { FilterForm } from './FilterForm';
import { EMPTY_FILTERS } from './filters';
import { STATS, summary } from './testing/fixtures.test-helpers';

const noop = () => undefined;

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
