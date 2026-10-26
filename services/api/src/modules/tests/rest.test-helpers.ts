// A small in-memory model of PostgREST as the caller, for the org-module tests (tests, publish, assignments,
// invitations). It applies `eq.`, `in.(…)`, `is.null` and `neq.` filters, `select` projection of plain column lists,
// `order=<col>.asc|desc`, and per-table hooks that stand in for the database's defaults, guard triggers and RLS
// (a hook throws RestError with the SQLSTATE the database would raise). Every call is recorded in order.
// Synthetic data only. The real grants, policies and triggers are checked by supabase/tests (lead) and by the
// rolled-back psql runs recorded in the R3a writer report.
import { RestError, type Query, type Rest } from './org-context.js';

export type Row = Record<string, unknown>;

export interface TableHooks {
  /** Defaults and BEFORE INSERT checks; returns the stored row or throws a RestError. */
  insert?: (row: Row, db: FakeDb) => Row;
  /** BEFORE UPDATE checks; returns the new row or throws (async for guards that hash). */
  update?: (oldRow: Row, newRow: Row, db: FakeDb) => Row | Promise<Row>;
  /** BEFORE DELETE checks; throws to refuse. */
  remove?: (row: Row, db: FakeDb) => void;
  /** Row-level visibility for every operation (RLS). Default: every row is visible. */
  visible?: (row: Row) => boolean;
  /** The DELETE policy's USING clause: rows it hides are silently not deleted (0 rows), as in Postgres. */
  deletable?: (row: Row) => boolean;
  /** The UPDATE policy's USING clause: rows it hides are silently not updated. */
  updatable?: (row: Row) => boolean;
}

/** A stand-in for a `public` INVOKER function: returns its JSON value or throws a RestError. */
export type RpcFake = (args: Readonly<Record<string, unknown>>, db: FakeDb) => unknown;

export type FakeMethod = 'select' | 'insert' | 'update' | 'remove' | 'rpc';

export interface FakeDb {
  tables: Record<string, Row[]>;
  hooks: Record<string, TableHooks>;
  /** `rpc` stand-ins by function name; an unknown name is 404 (PGRST202). */
  functions: Record<string, RpcFake>;
  calls: { method: FakeMethod; table: string; query: Query }[];
  /** Makes the next call to `table` (or function) with this method fail with this status and SQLSTATE. */
  failNext(method: FakeMethod, table: string, err: RestError): void;
  /** Runs at the start of each rpc, before its rollback snapshot (a concurrent caller's committed write). */
  beforeRpc?: (fn: string) => void;
}

const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);
const compare = (value: unknown, raw: string): number => {
  const v = unquote(raw);
  if (typeof value === 'number') return value - Number(v);
  const s = String(value);
  return s < v ? -1 : s > v ? 1 : 0;
};

/** Splits `a,b(c,d),e` at top-level commas (PostgREST logic trees). */
const splitTop = (text: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
};

/** One `col.op.value` term or a nested `and(…)` / `or(…)` of an `or=(…)` filter. */
const logic = (row: Row, term: string): boolean => {
  const m = /^(and|or)\((.*)\)$/.exec(term);
  if (m !== null) {
    const parts = splitTop(m[2] ?? '');
    return m[1] === 'and' ? parts.every((p) => logic(row, p)) : parts.some((p) => logic(row, p));
  }
  const dot = term.indexOf('.');
  return matches(row, term.slice(0, dot), term.slice(dot + 1));
};

const matches = (row: Row, key: string, filter: string): boolean => {
  const value = row[key];
  if (key === 'or') {
    if (!filter.startsWith('(') || !filter.endsWith(')')) throw new Error('fake rest: bad or');
    return splitTop(filter.slice(1, -1)).some((t) => logic(row, t));
  }
  for (const [op, test] of [
    ['gt.', (c: number) => c > 0],
    ['gte.', (c: number) => c >= 0],
    ['lt.', (c: number) => c < 0],
    ['lte.', (c: number) => c <= 0],
  ] as const) {
    if (filter.startsWith(op)) {
      return value !== undefined && value !== null && test(compare(value, filter.slice(op.length)));
    }
  }
  if (filter.startsWith('eq.')) {
    return value !== undefined && String(value) === unquote(filter.slice(3));
  }
  if (filter.startsWith('neq.')) return String(value) !== filter.slice(4);
  if (filter === 'is.null') return value === null || value === undefined;
  if (filter === 'not.is.null') return value !== null && value !== undefined;
  if (filter.startsWith('in.(') && filter.endsWith(')')) {
    const set = filter.slice(4, -1).split(',');
    return set.includes(String(value));
  }
  throw new Error(`fake rest: unsupported filter ${key}=${filter}`);
};

const RESERVED = new Set(['select', 'order', 'limit']);

const apply = (rows: Row[], query: Query): Row[] => {
  let out = rows.filter((row) =>
    Object.entries(query).every(([k, v]) => RESERVED.has(k) || matches(row, k, v)),
  );
  const order = query.order;
  if (order !== undefined) {
    const keys = order.split(',').map((part) => {
      const [col = '', dir = 'asc'] = part.split('.');
      return { col, dir };
    });
    out = [...out].sort((a, b) => {
      for (const { col, dir } of keys) {
        const x = a[col] as string | number;
        const y = b[col] as string | number;
        if (x === y) continue;
        const cmp = x < y ? -1 : 1;
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }
  if (query.limit !== undefined) out = out.slice(0, Number(query.limit));
  return out;
};

const project = (row: Row, select: string | undefined): Row => {
  if (select === undefined || select === '*') return { ...row };
  const out: Row = {};
  for (const col of select.split(',')) {
    if (!/^[a-z0-9_]+$/.test(col)) throw new Error(`fake rest: unsupported select ${col}`);
    if (!(col in row)) throw new Error(`fake rest: unknown column ${col}`);
    out[col] = row[col];
  }
  return out;
};

export const fakeDb = (
  tables: Record<string, Row[]> = {},
  hooks: Record<string, TableHooks> = {},
  functions: Record<string, RpcFake> = {},
): FakeDb & { rest: Rest } => {
  const failures: { method: string; table: string; err: RestError }[] = [];
  const db: FakeDb = {
    tables,
    hooks,
    functions,
    calls: [],
    failNext(method, table, err) {
      failures.push({ method, table, err });
    },
  };
  const take = (method: string, table: string) => {
    const i = failures.findIndex((f) => f.method === method && f.table === table);
    if (i < 0) return;
    const [f] = failures.splice(i, 1);
    if (f !== undefined) throw f.err;
  };
  const rowsOf = (table: string) => {
    db.tables[table] ??= [];
    return db.tables[table];
  };
  const visible = (table: string) => (row: Row) => db.hooks[table]?.visible?.(row) ?? true;
  const rest: Rest = {
    select: async <T>(table: string, query: Query) => {
      db.calls.push({ method: 'select', table, query });
      take('select', table);
      return apply(rowsOf(table).filter(visible(table)), query).map((r) =>
        project(r, query.select),
      ) as T[];
    },
    insert: async <T>(table: string, body: unknown, query: Query = {}) => {
      db.calls.push({ method: 'insert', table, query });
      take('insert', table);
      const input = (Array.isArray(body) ? body : [body]) as Row[];
      // One statement: every row passes the hooks before any is stored.
      const staged = input.map((raw) => {
        const row = db.hooks[table]?.insert?.({ ...raw }, db) ?? { ...raw };
        if (!visible(table)(row)) throw new RestError(403, '42501');
        return row;
      });
      rowsOf(table).push(...staged);
      return staged.map((r) => project(r, query.select)) as T[];
    },
    update: async <T>(table: string, query: Query, patch: unknown) => {
      db.calls.push({ method: 'update', table, query });
      take('update', table);
      const rows = rowsOf(table);
      const targets = apply(
        rows.filter(visible(table)).filter((r) => db.hooks[table]?.updatable?.(r) ?? true),
        query,
      );
      const next: { old: Row; row: Row }[] = [];
      for (const old of targets) {
        const merged = { ...old, ...(patch as Row) };
        next.push({ old, row: (await db.hooks[table]?.update?.(old, merged, db)) ?? merged });
      }
      for (const { old, row } of next) rows[rows.indexOf(old)] = row;
      return next.map(({ row }) => project(row, query.select)) as T[];
    },
    remove: async <T>(table: string, query: Query) => {
      db.calls.push({ method: 'remove', table, query });
      take('remove', table);
      const rows = rowsOf(table);
      const targets = apply(
        rows.filter(visible(table)).filter((r) => db.hooks[table]?.deletable?.(r) ?? true),
        query,
      );
      for (const row of targets) db.hooks[table]?.remove?.(row, db);
      db.tables[table] = rows.filter((r) => !targets.includes(r));
      return targets.map((r) => project(r, query.select)) as T[];
    },
    rpc: async <T>(fn: string, args: Readonly<Record<string, unknown>>) => {
      db.calls.push({ method: 'rpc', table: fn, query: {} });
      take('rpc', fn);
      const impl = db.functions[fn];
      if (impl === undefined) throw new RestError(404, 'PGRST202');
      // A write committed by another caller just before this call takes its locks (outside its transaction).
      db.beforeRpc?.(fn);
      // One transaction: a throw leaves every table as it was.
      const snapshot = structuredClone(db.tables);
      try {
        return (await impl(args, db)) as T;
      } catch (err) {
        db.tables = snapshot;
        throw err;
      }
    },
  };
  return Object.assign(db, { rest });
};

/** Deterministic v4-shaped ids for fixtures: `${prefix}0000-0000-4000-8000-${n}`. */
export const idMaker = (prefix: string) => {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
};

export const guardError = (): RestError => new RestError(403, '42501');
