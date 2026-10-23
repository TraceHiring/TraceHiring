// Synthetic-data renders of the library screens for tests/m1-guards.test.tsx (AT-M1-24), by name. See
// src/m1-screen-registry.test-helpers.ts. The route module itself is rendered by the guard file.
import type { ReactNode } from 'react';
import { libraryCard, uid } from '../bank/testing/fixtures.test-helpers';
import { CopyDoneLine, CopyListPanel, LibraryCards } from './LibraryRoute';

const noop = () => undefined;

export function m1Screens(): Record<string, ReactNode> {
  const list = [{ id: uid(5001), stem: '[synthetic] Library stem 1' }];
  return {
    'library cards': (
      <LibraryCards
        cards={[
          libraryCard(1),
          libraryCard(2, { format: 'written', options: undefined }),
          libraryCard(3, { isParameterised: true }),
        ]}
        list={list}
        onAdd={noop}
      />
    ),
    'library cards empty': <LibraryCards cards={[]} list={[]} onAdd={noop} />,
    'library copy list': <CopyListPanel list={list} busy={false} onRemove={noop} onCopy={noop} />,
    'library copy done': <CopyDoneLine copied={2} />,
    'library copy done one': <CopyDoneLine copied={1} />,
    'library copy list empty': (
      <CopyListPanel list={[]} busy={false} onRemove={noop} onCopy={noop} />
    ),
  };
}
