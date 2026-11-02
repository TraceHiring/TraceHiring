// Read helpers for the reports module: every select is made as the caller (RLS decides) and carries the path org
// (a caller in two orgs sees rows of both through RLS, so the org filter is ours to add, §6.2 R3-8). Rows are parsed
// strictly; a shape the contract does not expect is `unavailable`, never passed through.
import type { z } from 'zod';
import { eq, orgFail, type Query, type Rest } from '../tests/org-context.js';

/** Long `in.(…)` lists are split so a request line stays short. */
const IN_CHUNK = 50;

export interface OrgReader {
  rows<T>(schema: z.ZodType<T>, table: string, query: Query): Promise<T[]>;
  /** At most one row; null when none is visible. */
  maybe<T>(schema: z.ZodType<T>, table: string, query: Query): Promise<T | null>;
  /** Exactly one visible row, or 404 not_found. */
  one<T>(schema: z.ZodType<T>, table: string, query: Query): Promise<T>;
  /** The rows whose `column` is one of `values`, in chunks. */
  rowsIn<T>(
    schema: z.ZodType<T>,
    table: string,
    column: string,
    values: readonly string[],
    query: Query,
  ): Promise<T[]>;
}

export const orgReader = (rest: Rest, orgId: string): OrgReader => {
  const rows = async <T>(schema: z.ZodType<T>, table: string, query: Query): Promise<T[]> => {
    const raw = await rest.select(table, { ...query, org_id: eq(orgId) });
    const out: T[] = [];
    for (const r of raw) {
      const parsed = schema.safeParse(r);
      if (!parsed.success) return orgFail('unavailable');
      out.push(parsed.data);
    }
    return out;
  };
  const maybe = async <T>(schema: z.ZodType<T>, table: string, query: Query): Promise<T | null> => {
    const found = await rows(schema, table, query);
    if (found.length > 1) return orgFail('unavailable');
    return found[0] ?? null;
  };
  const one = async <T>(schema: z.ZodType<T>, table: string, query: Query): Promise<T> => {
    const found = await maybe(schema, table, query);
    return found ?? orgFail('not_found');
  };
  // `values` are ids taken from rows already parsed as uuids, so the list cannot carry PostgREST syntax.
  const rowsIn = async <T>(
    schema: z.ZodType<T>,
    table: string,
    column: string,
    values: readonly string[],
    query: Query,
  ): Promise<T[]> => {
    const unique = [...new Set(values)];
    const out: T[] = [];
    for (let i = 0; i < unique.length; i += IN_CHUNK) {
      const chunk = unique.slice(i, i + IN_CHUNK);
      out.push(...(await rows(schema, table, { ...query, [column]: `in.(${chunk.join(',')})` })));
    }
    return out;
  };
  return { rows, maybe, one, rowsIn };
};
