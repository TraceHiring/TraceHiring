// Test doubles for the demo outbox: a fake of the DO SQLite surface that interprets only OUTBOX_SQL, and a namespace
// whose stubs are in-memory OutboxStores. Used by the outbox, candidate and invitation tests.
import { OUTBOX_SQL, OutboxStore, type SqlStorageLike } from './outbox-store.js';
import type { OutboxNamespace } from './outbox-writer.js';

export const fakeOutboxSql = (): SqlStorageLike & { rows: Record<string, SqlStorageValue>[] } => {
  const rows: Record<string, SqlStorageValue>[] = [];
  let seq = 0;
  return {
    rows,
    exec(query, ...b) {
      if (query === OUTBOX_SQL.create) return { toArray: () => [] };
      if (query === OUTBOX_SQL.insert) {
        if (!rows.some((r) => r.idem === b[5])) {
          seq += 1;
          rows.push({
            seq,
            id: b[0] ?? null,
            created_at: b[1] ?? null,
            kind: b[2] ?? null,
            candidate_label: b[3] ?? null,
            body_text: b[4] ?? null,
            idem: b[5] ?? null,
          });
        }
        return { toArray: () => [] };
      }
      if (query === OUTBOX_SQL.trim) {
        const keepFrom = seq - Number(b[0]);
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (Number(rows[i]?.seq) <= keepFrom) rows.splice(i, 1);
        }
        return { toArray: () => [] };
      }
      if (query === OUTBOX_SQL.list) {
        const out = [...rows].sort((x, y) => Number(y.seq) - Number(x.seq)).slice(0, Number(b[0]));
        return { toArray: () => out };
      }
      throw new Error('unexpected statement');
    },
  };
};

/** A namespace whose stubs are in-memory OutboxStores, one per name. */
export const fakeOutboxNamespace = (): OutboxNamespace & { stores: Map<string, OutboxStore> } => {
  const stores = new Map<string, OutboxStore>();
  let n = 0;
  return {
    stores,
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => {
      const name = id.toString();
      let store = stores.get(name);
      if (store === undefined) {
        store = new OutboxStore(fakeOutboxSql());
        stores.set(name, store);
      }
      const s = store;
      return {
        append: (e) => {
          n += 1;
          s.append(
            e,
            `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            '2026-10-17T08:00:00.000Z',
          );
        },
        list: () => s.list(),
      };
    },
  };
};
