-- D1 forward fix D1-DB-1 (docs/reviews/D1.md; spec specs/d1-demo-slice.md §3.2 integrity.flags, §3.7 I-3; rule 3).
-- The five D1 migrations are applied to staging and frozen (R-17), so this file replaces private.integrity_flags_guard
-- in place of editing migration 3.
--
-- A flag must now match a validated rule of the session's pinned rule table (session -> ruleset_versions ->
-- integrity.band_rule_versions.rules): the rule id exists, `validated` is true, and family, tier, severity, untrusted
-- and rawMedia (absent = false) are equal to the rule's. This is the database's second line behind the band engine,
-- which already creates flags only for validated rules (packages/band-engine/src/band.ts step 1) and copies these
-- fields from the rule (workers/jobs/src/integrity/band-call.ts). Without it the trusted integrity worker could store a
-- flag for a context-only rule, a raised tier, an unknown rule or a family outside the table (gaze included), and the
-- integrity card guard would accept Strong concern on that flag's own claimed tier.
--
-- Error contract (as migration 3):
--   no validated rule with this id in the session's rule table   42501 'TRACE_GUARD: a flag needs a validated rule ...'
--   the rule exists, but a field differs                         42501 'TRACE_GUARD: the flag does not match its rule'
--   untrusted / raw_media on a T1/T2 row                         23514 'TRACE_GUARD: untrusted or raw_media needs a T3 ...'
-- The rule-table check runs first; the card-final, quality-card and not_used checks of migration 3 follow unchanged.
-- Tests: supabase/tests/rls_d1_cards.test.sql section "D1-DB-1".

create or replace function private.integrity_flags_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meets boolean;
  v_card_state text;
  v_rule jsonb;
begin
  if tg_op <> 'INSERT' then
    raise exception 'TRACE_GUARD: flags are immutable in D1' using errcode = '42501';
  end if;
  -- The T3-only rule is refused here with the CHECK's own code (23514), so it never depends on the CHECK staying.
  if (new.untrusted or new.raw_media) and new.tier is distinct from 'T3' then
    raise exception 'TRACE_GUARD: untrusted or raw_media needs a T3 flag (rule 3)' using errcode = '23514';
  end if;
  -- D1-DB-1 (rule 3): the flag is a validated rule of the session's own pinned rule table, field for field.
  select r into v_rule
  from public.sessions as s
  join public.ruleset_versions as rv on rv.org_id = s.org_id and rv.id = s.ruleset_version_id
  join integrity.band_rule_versions as b on b.org_id = rv.org_id and b.id = rv.band_rule_version_id
  cross join lateral jsonb_array_elements(b.rules) as r
  where s.org_id = new.org_id and s.id = new.session_id and r ->> 'id' = new.rule_id
    and r -> 'validated' = 'true'::jsonb;
  if not found then
    raise exception 'TRACE_GUARD: a flag needs a validated rule of the session''s rule table' using errcode = '42501';
  end if;
  if new.family is distinct from v_rule ->> 'family'
    or new.tier is distinct from v_rule ->> 'tier'
    or new.severity is distinct from v_rule ->> 'severity'
    or new.untrusted is distinct from coalesce((v_rule ->> 'untrusted')::boolean, false)
    or new.raw_media is distinct from coalesce((v_rule ->> 'rawMedia')::boolean, false) then
    raise exception 'TRACE_GUARD: the flag does not match its rule' using errcode = '42501';
  end if;
  -- Once the session's integrity card is final its band can no longer be re-checked, so no flag is added (I-3). The
  -- share lock serialises this insert with the card's single flip (DB review m3 m-1).
  select c.review_state into v_card_state
  from public.integrity_cards as c where c.org_id = new.org_id and c.session_id = new.session_id
  for share;
  if found and v_card_state <> 'awaiting_quality' then
    raise exception 'TRACE_GUARD: no flag is added once the integrity card is final' using errcode = '42501';
  end if;
  select c.meets_cutoff into v_meets
  from public.quality_cards as c where c.org_id = new.org_id and c.session_id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: a flag needs the session quality card' using errcode = '42501';
  end if;
  if (new.state = 'not_used') is distinct from (not v_meets) then
    raise exception 'TRACE_GUARD: a flag is not_used exactly when the session is below its cutoff'
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.integrity_flags_guard() from public, anon, authenticated, service_role;
