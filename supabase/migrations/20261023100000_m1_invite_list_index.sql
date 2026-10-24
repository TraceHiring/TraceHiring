-- Migration M1-j (specs/m1-test-authoring.md R5-63 h; Opus database review of A2b, L6): the api lists an org's member
-- invites as keyset pages on (created_at, id); this index serves them without sorting every invite of the org.
create index member_invites_page_idx on public.member_invites (org_id, created_at, id);
