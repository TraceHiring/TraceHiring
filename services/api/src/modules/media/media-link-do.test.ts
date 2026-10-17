// AT-D10 (api half): MediaLinkDO's store. The burn is one `UPDATE … WHERE state = 'open' AND exp >= ? RETURNING`, so
// a second or concurrent burn gets nothing (DC-D5). Runs on a fake of the DO SQLite surface that interprets only
// LINK_SQL; a real-DO run needs the MEDIA_LINKS binding in the test pool's config (lead request).
import { describe, expect, it } from 'vitest';
import { LINK_SQL, LinkStore, type LinkRecord } from './link-store.js';
import { fakeLinkSql, MEDIA, ORG, VIEWER } from './media.test-helpers.js';

const JTI = '9a000000-0000-4000-8000-000000000001';
const record = (exp: number): LinkRecord => ({
  mediaId: MEDIA,
  orgId: ORG,
  viewerUserId: VIEWER,
  aal: 'aal2',
  amr: ['password', 'totp'],
  exp,
});

describe('LinkStore', () => {
  it('burns an open link once and returns the stored record', () => {
    const store = new LinkStore(fakeLinkSql());
    store.issue(JTI, record(1000));
    expect(store.burn(JTI, 900)).toEqual(record(1000));
    expect(store.burn(JTI, 900)).toBeNull();
  });

  it('does not burn an expired or unknown link', () => {
    const store = new LinkStore(fakeLinkSql());
    store.issue(JTI, record(1000));
    expect(store.burn(JTI, 1001)).toBeNull();
    expect(store.burn('9a000000-0000-4000-8000-000000000002', 900)).toBeNull();
  });

  it('never reissues a jti', () => {
    const store = new LinkStore(fakeLinkSql());
    store.issue(JTI, record(1000));
    expect(() => store.issue(JTI, record(2000))).toThrow();
    expect(store.burn(JTI, 900)?.exp).toBe(1000);
  });

  it('concurrent burns: exactly one record', async () => {
    const store = new LinkStore(fakeLinkSql());
    store.issue(JTI, record(1000));
    const results = await Promise.all(Array.from({ length: 25 }, async () => store.burn(JTI, 900)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('the burn is a single conditional UPDATE … RETURNING (no read-then-write)', () => {
    expect(LINK_SQL.burn).toMatch(
      /^update links set state = 'burnt' where jti = \? and state = 'open' and exp >= \? returning record$/,
    );
  });

  it('allows 20 issues a minute per viewer, then refuses until the next minute', () => {
    const store = new LinkStore(fakeLinkSql());
    const results = Array.from({ length: 21 }, () => store.allowIssue(1_800_000_010));
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(store.allowIssue(1_800_000_070)).toBe(true);
  });
});
