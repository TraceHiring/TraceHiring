// RED stub (tests first): replaced by the implementation.
import type { LibraryItemCard, PageCursor } from '@trace/shared/contracts/m1';
import type { OrgCaller } from '../tests/org-context.js';

export interface LibraryBrowseInput {
  skillKey?: string;
  format?: 'mcq' | 'written';
  difficultyMin?: number;
  difficultyMax?: number;
  after: PageCursor | null;
  limit: number;
}
export interface LibraryCardRow {
  card: LibraryItemCard;
  createdAt: string;
}
export interface LibrarySource {
  browse(caller: OrgCaller, orgId: string, input: LibraryBrowseInput): Promise<LibraryCardRow[]>;
}
