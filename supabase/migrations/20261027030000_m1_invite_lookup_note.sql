-- M1-v (M1 FIX, docs/reviews/M1.md M1-REV-8; spec specs/m1-test-authoring.md revision 5 R5-72 c): a correction, no
-- behaviour change. The header of migration M1-g (20261023070000_m1_members_drafts_fixes.sql, item 1) says the E26
-- lookup "cannot" be used as a general address-to-user lookup. It can, by trace_admin_worker: the function checks a
-- pending invite of the job org and its inviter, but never binds p_email to that invite's email_hmac, and the worker sets
-- trace.job_org_id itself. A DB-side binding would need the invite pepper inside the database, which it must not hold.
-- The residual risk is accepted: the same worker already holds the Auth admin API, which can list users by address. The
-- comment below is the accurate statement; it supersedes M1-g's header. Pinned by rls_m1_review_fixes.
comment on function private.auth_user_id_for_invite(uuid, text) is
  'E26: the Auth user id that already holds an invited address, for trace_admin_worker. Requires a pending invite in '
  'the job org (trace.job_org_id, which the worker sets itself, so any org with a pending invite) whose inviter is '
  'still an active admin (owner, for an owner invite) of an active org. Not bound to the invite''s address: p_email '
  'is not checked against email_hmac (the pepper stays outside the database), so the worker can look up any address '
  'while it names a pending invite. Accepted residual risk (M1-REV-8): the worker already holds the Auth admin API. '
  'Skips SSO, anonymous and deleted users; returns only the id; refuses when more than one account holds the address.';
