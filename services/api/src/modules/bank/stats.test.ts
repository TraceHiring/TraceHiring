// AT-M1-06 (ABH-7 "≥40% of quant items vary", spec m1 §6.3, R5-27): `GET …/bank/stats` returns the share of approved
// `quant` items that are parameterised, from the counting view `v_item_bank_quant_share` (M1-a: only skill `quant`,
// only approved versions, one row per workspace the caller can read). The api sums the caller's rows and divides; with
// no approved quant item the share is null (no division by zero). The library half is null: no library metric is served
// to a customer (R5-36 keeps cross-tenant volumes away from customers). The db-backed half of the counting query is
// `rls_m1_bank` (lead). Synthetic fixture counts only.
import { BankStatsResponse } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { a2aDb, callerOf, harness, ORG, ORG_B, WS, WS2 } from './a2a.test-helpers.js';
import { createBankRoutes } from './routes.js';
import { quantShareOf } from './stats.js';

const setup = (rows: Record<string, unknown>[], roles?: string[]) => {
  const db = a2aDb(roles === undefined ? {} : { roles });
  db.tables.v_item_bank_quant_share = rows;
  const { call } = harness(
    (org) => createBankRoutes({ org, variants: () => null }),
    db,
    callerOf(),
  );
  return { db, call };
};

describe('quantShareOf', () => {
  it('sums the workspace rows and divides parameterised by approved', () => {
    expect(
      quantShareOf([
        { quant_items_approved: 6, quant_items_parameterised: 2 },
        { quant_items_approved: 4, quant_items_parameterised: 2 },
      ]),
    ).toEqual({ quantItemsApproved: 10, quantItemsParameterised: 4, share: 0.4 });
  });

  it('is null with no approved quant item', () => {
    expect(quantShareOf([])).toEqual({
      quantItemsApproved: 0,
      quantItemsParameterised: 0,
      share: null,
    });
  });
});

describe('GET …/bank/stats (AT-M1-06)', () => {
  it('answers the share over the org rows only', async () => {
    const { db, call } = setup([
      { org_id: ORG, workspace_id: WS, quant_items_approved: 3, quant_items_parameterised: 1 },
      { org_id: ORG, workspace_id: WS2, quant_items_approved: 2, quant_items_parameterised: 1 },
      { org_id: ORG_B, workspace_id: WS, quant_items_approved: 90, quant_items_parameterised: 90 },
    ]);
    const res = await call('GET', '/bank/stats');
    expect(res.status).toBe(200);
    const body = BankStatsResponse.parse(await res.json());
    expect(body).toEqual({
      org: { quantItemsApproved: 5, quantItemsParameterised: 2, share: 0.4 },
      library: null,
    });
    const read = db.calls.find((c) => c.table === 'v_item_bank_quant_share');
    expect(read?.query.org_id).toBe(`eq.${ORG}`);
  });

  it('answers a null share when nothing is approved', async () => {
    const { call } = setup([]);
    const body = BankStatsResponse.parse(await (await call('GET', '/bank/stats')).json());
    expect(body.org.share).toBeNull();
  });

  it('is not for reviewers (owners, admins and recruiters only)', async () => {
    const { call } = setup([], ['reviewer']);
    expect((await call('GET', '/bank/stats')).status).toBe(404);
  });
});
