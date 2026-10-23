// The bank and library filter forms as queries (BankItemListQuery, LibraryBrowseQuery). Query-string values are text;
// difficulties are decimal text 0 to 1 (R5-54 a). A bad value is named here, before any request is made.
import {
  BankItemListQuery,
  LibraryBrowseQuery,
  SkillKey,
  type ItemFormat,
  type ItemOrigin,
  type ItemStatus,
} from '@trace/shared/contracts/m1';

export interface Filters {
  format: '' | ItemFormat;
  skillKey: string;
  difficultyMin: string;
  difficultyMax: string;
  status: '' | ItemStatus;
  origin: '' | ItemOrigin;
  poolId: string;
}

export const EMPTY_FILTERS: Filters = {
  format: '',
  skillKey: '',
  difficultyMin: '',
  difficultyMax: '',
  status: '',
  origin: '',
  poolId: '',
};

type BankWire = (typeof BankItemListQuery)['_zod']['input'];
type LibraryWire = (typeof LibraryBrowseQuery)['_zod']['input'];
export type QueryResult<W> = { ok: true; query: W } | { ok: false; message: string };

const DECIMAL = /^[01](\.[0-9]{1,6})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAD_DIFFICULTY = 'Difficulty must be a number from 0 to 1.';

function common(filters: Filters, query: Record<string, string>): string | null {
  if (filters.format !== '') query['format'] = filters.format;
  const skill = filters.skillKey.trim();
  if (skill !== '') {
    if (!SkillKey.safeParse(skill).success) {
      return 'A skill is lower-case letters, digits and underscores.';
    }
    query['skillKey'] = skill;
  }
  for (const key of ['difficultyMin', 'difficultyMax'] as const) {
    const value = filters[key].trim();
    if (value === '') continue;
    if (!DECIMAL.test(value) || Number(value) > 1) return BAD_DIFFICULTY;
    query[key] = value;
  }
  const min = query['difficultyMin'];
  const max = query['difficultyMax'];
  if (min !== undefined && max !== undefined && Number(min) > Number(max)) {
    return 'The minimum difficulty cannot be above the maximum.';
  }
  return null;
}

/** The bank list query: the filled fields as text, plus the cursor of the page to load. */
export function bankQuery(filters: Filters, cursor?: string): QueryResult<BankWire> {
  const query: Record<string, string> = {};
  const problem = common(filters, query);
  if (problem !== null) return { ok: false, message: problem };
  if (filters.status !== '') query['status'] = filters.status;
  if (filters.origin !== '') query['origin'] = filters.origin;
  const pool = filters.poolId.trim();
  if (pool !== '') {
    if (!UUID.test(pool)) {
      return { ok: false, message: 'A pool id looks like 00000000-0000-4000-8000-000000000001.' };
    }
    query['poolId'] = pool;
  }
  if (cursor !== undefined) query['cursor'] = cursor;
  if (!BankItemListQuery.safeParse(query).success) {
    return { ok: false, message: 'Some filter values were not accepted.' };
  }
  return { ok: true, query: query as BankWire };
}

/** The library browse query: skill, format and difficulty only. */
export function libraryQuery(filters: Filters, cursor?: string): QueryResult<LibraryWire> {
  const query: Record<string, string> = {};
  const problem = common(filters, query);
  if (problem !== null) return { ok: false, message: problem };
  if (cursor !== undefined) query['cursor'] = cursor;
  if (!LibraryBrowseQuery.safeParse(query).success) {
    return { ok: false, message: 'Some filter values were not accepted.' };
  }
  return { ok: true, query: query as LibraryWire };
}
