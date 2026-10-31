-- rls_m1_settings (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_settings; §3.2 integrity_setting_defs, integrity_presets, org_integrity_locks; §3.3 ruleset_versions; §3.4 derive_signal_settings; §6.6, §6.7; AT-M1-15, AT-M1-16, AT-M1-17 (DB half); I-M1-6, I-M1-7, I-M1-11; R2-5, R3-1, R3-7, R5-5, R5-23 b, R5-26, R5-31, R5-34, R5-39 c, d; E16). RED first: written from the spec before migration M1-b. Personas are synthetic.
-- Fixtures (operator path): org A rule table v2 = the D1 rules plus X-COPY (kinds ['copy'], no settings key) and X-MIX
-- (kinds ['paste', 'copy']), so drafts made below pin it. Versions: vstd (Standard), vstr (Strict), e16 (Standard,
-- saved before any lock), r34 (D1-style, no settings), t1 (draft for the settings writes).
insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values
  (pg_temp.id('A'), 2, array['paste', 'input_origin', 'focus'], 700, 750,
   (select b.rules from integrity.band_rule_versions as b where b.org_id = pg_temp.id('A') and b.version_no = 1)
     || '[{"id": "X-COPY", "kinds": ["copy"], "family": "paste", "tier": "T3", "severity": "soft", "validated": true}, {"id": "X-MIX", "kinds": ["paste", "copy"], "family": "paste", "tier": "T3", "severity": "soft", "validated": true}]'::jsonb,
   repeat('f', 64));
select pg_temp.tv('vstd', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sstd', 'vstd', 1, 'mcq', null, null, 100);
select pg_temp.inline('istd', 'sstd');
select pg_temp.preset('vstd', 'standard');
select pg_temp.publish('vstd');
select pg_temp.tv('vstr', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sstr', 'vstr', 1, 'mcq', null, null, 100);
select pg_temp.inline('istr', 'sstr');
select pg_temp.preset('vstr', 'strict');
select pg_temp.publish('vstr');
select pg_temp.tv('e16', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('se16', 'e16', 1, 'mcq', null, null, 100);
select pg_temp.inline('ie16', 'se16');
select pg_temp.preset('e16', 'standard');
select pg_temp.tv('r34', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-0000000000c1', pg_temp.id('A'), pg_temp.id('r34'), 1, 'Choices', 'mcq', 1);
insert into pg_temp.ids values ('sr34', '51000000-0000-4000-8000-0000000000c1');
select pg_temp.inline('ir34', 'sr34');
-- w34 (Strict, paste blocked) has a written section that allows paste (DB-M1-1).
select pg_temp.tv('w34', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight, navigation, paste_rule) values
  ('51000000-0000-4000-8000-0000000000c2', pg_temp.id('A'), pg_temp.id('w34'), 1, 'Essay', 'written', 100, 'forward_only', 'allowed_logged');
insert into public.item_versions (org_id, section_id, format, position, stem, rubric_version_id, content_sha256) values
  (pg_temp.id('A'), '51000000-0000-4000-8000-0000000000c2', 'written', 1, '[synthetic] Essay',
   (select r.id from public.rubric_versions as r where r.org_id = pg_temp.id('A') and r.rubric_key = 'default'), repeat('c', 64));
select pg_temp.preset('w34', 'strict');
select is((select paste_rule from public.sections where id = '51000000-0000-4000-8000-0000000000c2'), 'blocked', 'DB-M1-1 (M1-p): storing Strict settings derives the written section''s paste rule');
-- The mismatch below never arises through a write since M1-p; the derive trigger is off to pin the publish guard.
alter table public.sections disable trigger sections_settings_derive;
update public.sections set paste_rule = 'allowed_logged' where id = '51000000-0000-4000-8000-0000000000c2';
alter table public.sections enable always trigger sections_settings_derive;
select pg_temp.tv('t1', pg_temp.id('A'), pg_temp.id('A1'));
insert into pg_temp.ids select 't1_rs', ruleset_version_id from public.test_versions where id = pg_temp.id('t1');
select pg_temp.session('sess_std', 'vstd', 1);
select pg_temp.session('sess_str', 'vstr', 2);
-- ss(signal_settings): the five D1 keys as key=enabled, sorted.
create function pg_temp.ss(p jsonb) returns text language sql as $f$
  select string_agg(k || '=' || (p -> k ->> 'enabled'), ',' order by k) from jsonb_object_keys(p) as k
$f$;
grant execute on function pg_temp.ss(jsonb) to public;
-- with_setting(preset, key, value): the preset's values with one setting changed (read from a copy taken on the operator
-- path, so any persona can build a payload).
create table pg_temp.presets as select preset_key, preset_values from public.integrity_presets where version = 1;
grant select on pg_temp.presets to public;
create function pg_temp.with_setting(p_preset text, p_key text, p_value text) returns jsonb language sql as $f$
  select p.preset_values || jsonb_build_object(p_key, p_value) from pg_temp.presets as p where p.preset_key = p_preset
$f$;
grant execute on function pg_temp.with_setting(text, text, text) to public;

-- ===== The catalog and presets (AT-M1-15; §6.6 table) =====
select is((select string_agg(concat_ws('|', setting_key, value_kind, allowed_values::text, default_value, always_locked::text, available_from, maps_to_signals::text), '; ' order by setting_key) from public.integrity_setting_defs where org_id = pg_temp.id('L') and catalog_version = 'm1-settings-v1'),
  'accommodations|fixed|{on}|on|true|M3b|{}; burst_after_tab|on_off|{on,off}|on|false|M4|{}; calibration_warmup|on_off|{on,off}|on|false|M4|{}; camera_face_presence|on_off|{on,off}|on|false|M4|{}; explain_probe|on_off|{on,off}|off|false|M4|{}; fullscreen_tab_focus|on_off_warn|{off,warn_first,on}|warn_first|false|D1|{tab_hidden,fullscreen_exit}; id_verification|fixed|{off}|off|true|phase2|{}; integrity_review_scope|fixed|{shortlist_only}|shortlist_only|true|D1|{}; mic_speech_presence|on_off|{on,off}|off|false|M4|{}; paste_written|paste_rule|{blocked,allowed_logged}|allowed_logged|false|D1|{paste,drop}; question_copy|on_off|{on,off}|on|false|M4|{}; single_screen|on_off|{on,off}|off|false|M4|{}; typing_provenance|on_off|{on,off}|on|false|D1|{untrusted_input}',
  'catalog: m1-settings-v1 holds the 13 settings of §6.6 (values, always-locked, runs from, D1 signals)');
select is((select count(*)::int from public.integrity_setting_defs where org_id is distinct from pg_temp.id('L')), 0, 'catalog: only the library org holds settings definitions');
select is((select preset_values from public.integrity_presets where preset_key = 'strict' and version = 1 and catalog_version = 'm1-settings-v1'), '{"calibration_warmup": "on", "typing_provenance": "on", "burst_after_tab": "on", "fullscreen_tab_focus": "on", "single_screen": "on", "camera_face_presence": "on", "mic_speech_presence": "on", "explain_probe": "on", "question_copy": "on", "paste_written": "blocked", "integrity_review_scope": "shortlist_only", "accommodations": "on", "id_verification": "off"}'::jsonb, 'preset: Strict matches §6.6');
select is((select preset_values from public.integrity_presets where preset_key = 'standard' and version = 1 and catalog_version = 'm1-settings-v1'), '{"calibration_warmup": "on", "typing_provenance": "on", "burst_after_tab": "on", "fullscreen_tab_focus": "warn_first", "single_screen": "off", "camera_face_presence": "on", "mic_speech_presence": "off", "explain_probe": "off", "question_copy": "on", "paste_written": "allowed_logged", "integrity_review_scope": "shortlist_only", "accommodations": "on", "id_verification": "off"}'::jsonb, 'preset: Standard matches §6.6');
select is((select preset_values from public.integrity_presets where preset_key = 'open_book' and version = 1 and catalog_version = 'm1-settings-v1'), '{"calibration_warmup": "on", "typing_provenance": "on", "burst_after_tab": "off", "fullscreen_tab_focus": "off", "single_screen": "off", "camera_face_presence": "off", "mic_speech_presence": "off", "explain_probe": "off", "question_copy": "off", "paste_written": "allowed_logged", "integrity_review_scope": "shortlist_only", "accommodations": "on", "id_verification": "off"}'::jsonb, 'preset: Open-book matches §6.6');
select matches(pg_temp.try($$update public.integrity_setting_defs set default_value = 'off' where setting_key = 'question_copy'$$), '^42501 TRACE_GUARD: the settings catalog and presets are immutable', 'catalog: immutable, even on the operator path');
select matches(pg_temp.try($$delete from public.integrity_setting_defs$$), '^42501 TRACE_GUARD: the settings catalog and presets are immutable', 'catalog: never deleted');
select matches(pg_temp.try($$truncate public.integrity_setting_defs cascade$$), '^42501 TRACE_GUARD: the settings catalog and presets are immutable', 'catalog: never truncated');
select matches(pg_temp.try($$update public.integrity_presets set preset_values = '{}'$$), '^42501 TRACE_GUARD: the settings catalog and presets are immutable', 'presets: immutable, even on the operator path');
select matches(pg_temp.try($$delete from public.integrity_presets$$), '^42501 TRACE_GUARD: the settings catalog and presets are immutable', 'presets: never deleted');
select matches(pg_temp.try(format($$insert into public.integrity_setting_defs (org_id, catalog_version, setting_key, value_kind, allowed_values, default_value, always_locked, available_from) values (%L, 'm1-settings-v1', 'gaze_tracking', 'on_off', '{on,off}', 'off', false, 'M4')$$, pg_temp.id('L'))), '^42501 TRACE_GUARD: the settings catalog and presets are immutable', 'catalog (DB-M1-8): no setting joins the sealed catalog, even on the operator path');
select matches(pg_temp.try(format($$insert into public.integrity_presets (org_id, preset_key, version, catalog_version, preset_values) values (%L, 'strict', 2, 'm1-settings-v1', '{}')$$, pg_temp.id('L'))), '^42501 TRACE_GUARD: the settings catalog and presets are immutable', 'presets (DB-M1-8): no preset joins the sealed catalog, even on the operator path');
select is((select count(*)::int from (select catalog_version from public.integrity_setting_defs union select catalog_version from public.integrity_presets) as c where not (c.catalog_version = any (private.sealed_settings_catalogs()))), 0, 'catalog (carried Low): every seeded catalog, the current one included, is sealed');
select is((select count(*)::int from public.integrity_setting_defs where catalog_version = 'm1-settings-v1') || '|' || (select count(*)::int from public.integrity_presets where catalog_version = 'm1-settings-v1'), '13|3', 'catalog (DB-M1-8): the sealed catalog keeps its 13 settings and 3 presets');
select pg_temp.u('owner');
select matches(pg_temp.try('select * from public.integrity_setting_defs'), '^42501 permission denied', 'catalog S: no authenticated grant (R2-5)');
select matches(pg_temp.try('select * from public.integrity_presets'), '^42501 permission denied', 'presets S: no authenticated grant (R2-5)');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.integrity_setting_defs'), '^42501 permission denied', 'catalog S: trace_api reads it only through private.library_reference');
select is((select jsonb_array_length(private.library_reference(pg_temp.id('recruiter'), 'aal1', '{otp}', 'settings') -> 0 -> 'settings')), 13, 'library_reference(settings): a recruiter of the api org gets the 13 settings');
select is((select jsonb_array_length(private.library_reference(pg_temp.id('recruiter'), 'aal1', '{otp}', 'settings') -> 0 -> 'presets')), 3, 'library_reference(settings): and the 3 presets');
select is((select private.library_reference(null, null, null, 'settings')), '[]'::jsonb, 'library_reference (R3-7): no viewer (candidate path) gets nothing');
select is((select private.library_reference(pg_temp.id('b_admin'), 'aal2', '{otp,totp}', 'settings')), '[]'::jsonb, 'library_reference: a viewer outside the api org gets nothing');
select is((select private.library_reference(pg_temp.id('hm'), 'aal1', '{otp}', 'settings')), '[]'::jsonb, 'library_reference: a hiring manager of the api org gets nothing');
select matches(pg_temp.try($$select private.library_reference(null, null, null, 'keys')$$), '^22023 TRACE_GUARD: unknown reference kind', 'library_reference: an unknown kind is refused');
select pg_temp.u('owner');
select matches(pg_temp.try($$select private.library_reference(null, null, null, 'settings')$$), '^42501 permission denied', 'library_reference: no authenticated EXECUTE');
select pg_temp.op();

-- ===== derive_signal_settings vectors (AT-M1-15; §6.7; R5-39 d) =====
select is(pg_temp.ss(private.derive_signal_settings(pg_temp.with_setting('strict', 'question_copy', 'on'), 'm1-settings-v1')), 'drop=true,fullscreen_exit=true,paste=true,tab_hidden=true,untrusted_input=true', 'derive: Strict switches nothing off');
select is(pg_temp.ss(private.derive_signal_settings(pg_temp.with_setting('standard', 'question_copy', 'on'), 'm1-settings-v1')), 'drop=false,fullscreen_exit=true,paste=false,tab_hidden=true,untrusted_input=true', 'derive: Standard (paste allowed, logged) switches paste and drop off as band inputs');
select is(pg_temp.ss(private.derive_signal_settings(pg_temp.with_setting('open_book', 'question_copy', 'off'), 'm1-settings-v1')), 'drop=false,fullscreen_exit=false,paste=false,tab_hidden=false,untrusted_input=true', 'derive: Open-book also switches focus off');
select is(pg_temp.ss(private.derive_signal_settings(pg_temp.with_setting('standard', 'paste_written', 'blocked'), 'm1-settings-v1')), 'drop=true,fullscreen_exit=true,paste=true,tab_hidden=true,untrusted_input=true', 'derive: paste blocked keeps paste and drop (D1 behaviour)');
select is(pg_temp.ss(private.derive_signal_settings(pg_temp.with_setting('standard', 'typing_provenance', 'off'), 'm1-settings-v1')), 'drop=false,fullscreen_exit=true,paste=false,tab_hidden=true,untrusted_input=false', 'derive (R5-39 d): typing provenance off switches untrusted_input off');
select is(pg_temp.ss(private.derive_signal_settings(pg_temp.with_setting('strict', 'fullscreen_tab_focus', 'warn_first'), 'm1-settings-v1')), 'drop=true,fullscreen_exit=true,paste=true,tab_hidden=true,untrusted_input=true', 'derive: focus warn-first keeps the focus signals');
select is(pg_temp.ss(private.derive_signal_settings(pg_temp.with_setting('strict', 'fullscreen_tab_focus', 'off'), 'm1-settings-v1')), 'drop=true,fullscreen_exit=false,paste=true,tab_hidden=false,untrusted_input=true', 'derive: focus off switches tab_hidden and fullscreen_exit off');
select is(pg_temp.ss(private.derive_signal_settings(pg_temp.with_setting('strict', 'camera_face_presence', 'off'), 'm1-settings-v1')), 'drop=true,fullscreen_exit=true,paste=true,tab_hidden=true,untrusted_input=true', 'derive: a setting that maps no D1 signal changes none');
select matches(pg_temp.try($$select private.derive_signal_settings('{}', 'no-such-catalog')$$), '^42501 TRACE_GUARD: unknown settings catalog', 'derive: an unknown catalog is an error');

-- ===== org_integrity_locks (AT-M1-16; §3.5: members read; admins at aal2 add and remove) =====
select pg_temp.u('admin');
select is(pg_temp.try($$insert into public.org_integrity_locks (id, org_id, setting_key, locked_value) values ('e2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'paste_written', 'blocked')$$), 'OK 1', 'locks I: admin (aal2) locks paste to blocked');
select matches(pg_temp.try($$insert into public.org_integrity_locks (org_id, setting_key, locked_value) values ('a1000000-0000-4000-8000-000000000001', 'integrity_review_scope', 'shortlist_only')$$), '^42501 TRACE_GUARD: this setting is always locked', 'locks I: an always-locked setting takes no lock row');
select matches(pg_temp.try($$insert into public.org_integrity_locks (org_id, setting_key, locked_value) values ('a1000000-0000-4000-8000-000000000001', 'question_copy', 'sometimes')$$), '^23514 TRACE_GUARD: setting value not allowed', 'locks I: a value outside the setting''s values is refused');
select matches(pg_temp.try($$insert into public.org_integrity_locks (org_id, setting_key, locked_value) values ('a1000000-0000-4000-8000-000000000001', 'gaze_tracking', 'on')$$), '^23503 TRACE_GUARD: setting not found', 'locks I: an unknown setting is refused');
select pg_temp.u('admin_aal1');
select matches(pg_temp.try($$insert into public.org_integrity_locks (org_id, setting_key, locked_value) values ('a1000000-0000-4000-8000-000000000001', 'question_copy', 'on')$$), '^42501', 'locks I: an admin at aal1 cannot lock (ADR-029)');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$insert into public.org_integrity_locks (org_id, setting_key, locked_value) values ('a1000000-0000-4000-8000-000000000001', 'question_copy', 'on')$$), '^42501', 'locks I: a recruiter cannot lock');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.org_integrity_locks (org_id, setting_key, locked_value) values ('a1000000-0000-4000-8000-000000000001', 'question_copy', 'on')$$), '^42501', 'locks I: org B admin cannot lock in org A');
select pg_temp.op();
select is((select pg_temp.keys(details) || '|' || (details ->> 'setting_key') || '|' || (actor_user_id = pg_temp.id('admin'))::text from public.audit_log where action = 'integrity_lock.create' and object_id = 'e2000000-0000-4000-8000-000000000001'), 'setting_key|paste_written|true', 'locks event: integrity_lock.create carries the setting key only, by the admin');
select is((select (locked_by = pg_temp.id('admin'))::text from public.org_integrity_locks where id = 'e2000000-0000-4000-8000-000000000001'), 'true', 'locks I: locked_by is the caller');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.org_integrity_locks), 1, 'locks S: a recruiter reads the org''s locks (the editor shows them)');
select is(pg_temp.try('delete from public.org_integrity_locks'), 'OK 0', 'locks D: a recruiter removes nothing');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.org_integrity_locks), 1, 'locks S: a reviewer reads them');
select pg_temp.u('hm');
select is((select count(*)::int from public.org_integrity_locks), 0, 'locks S: a hiring manager reads nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.org_integrity_locks), 0, 'locks S: org B admin reads nothing of org A');
select pg_temp.u('admin');
select matches(pg_temp.try($$update public.org_integrity_locks set locked_value = 'allowed_logged'$$), '^42501 permission denied', 'locks U: no update grant');
select pg_temp.op();
select matches(pg_temp.try($$update public.org_integrity_locks set locked_value = 'allowed_logged'$$), '^42501 TRACE_GUARD: a lock is removed and added, never changed', 'locks U: never changed, even on the operator path');

-- ===== ruleset_versions settings (I-M1-6, I-M1-7; R3-1) =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.ruleset_versions set preset_key = 'strict', settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'question_copy', 'on'))), 'OK 1', 'settings U: a recruiter saves the Strict preset on a draft');
select pg_temp.op();
select is((select catalog_version || '|' || preset_version::text || '|' || pg_temp.ss(signal_settings) from public.ruleset_versions where id = pg_temp.id('t1_rs')), 'm1-settings-v1|1|drop=true,fullscreen_exit=true,paste=true,tab_hidden=true,untrusted_input=true', 'settings U (I-M1-7): the catalog and preset version are set and signal_settings is derived');
select is((select pg_temp.keys(details) || '|' || (details ->> 'preset_key') from public.audit_log where action = 'test.integrity_settings' and object_id = pg_temp.id('t1_rs')), 'catalog_version,preset_key|strict', 'settings event (R5-26): test.integrity_settings carries the preset and catalog only');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$update public.ruleset_versions set signal_settings = '{"paste": {"enabled": false}}' where id = pg_temp.id('t1_rs')$$), '^42501 permission denied', 'settings U (I-M1-7): signal_settings is never client-written');
select matches(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'paste_written', 'allowed_logged'))), '^42501 TRACE_GUARD: setting locked by admin', 'settings U (I-M1-6): a locked setting with another value is refused');
select matches(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'accommodations', 'off'))), '^23514 TRACE_GUARD: setting value not allowed', 'settings U (AT-M1-16): accommodations is always on');
select matches(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'integrity_review_scope', 'everyone'))), '^23514 TRACE_GUARD: setting value not allowed', 'settings U (AT-M1-16, rule 6): integrity review scope is only shortlist_only');
select matches(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'id_verification', 'on'))), '^23514 TRACE_GUARD: setting value not allowed', 'settings U: id verification stays off (Phase 2)');
select matches(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'question_copy', 'on') - 'question_copy')), '^23514 TRACE_GUARD: the settings name every setting of the catalog', 'settings U: a missing setting is refused');
select matches(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'emotion_detection', 'on'))), '^23514 TRACE_GUARD: the settings name every setting of the catalog', 'settings U (rule 7): an unknown setting is refused');
select matches(pg_temp.try($$update public.ruleset_versions set preset_key = 'lenient' where id = pg_temp.id('t1_rs')$$), '^23503 TRACE_GUARD: preset not found', 'settings U: an unknown preset key is refused');
select matches(pg_temp.try($$update public.ruleset_versions set settings = null where id = pg_temp.id('t1_rs')$$), '^42501 TRACE_GUARD: settings once set are not removed', 'settings U: settings once set are never removed');
select matches(pg_temp.try($$update public.ruleset_versions set preset_key = 'standard' where id = (select ruleset_version_id from public.test_versions where id = pg_temp.id('r34'))$$), '^42501 TRACE_GUARD: a preset needs its settings', 'settings U (DB-M1-7): a preset key without settings is refused');
select matches(pg_temp.try($$update public.ruleset_versions set preset_version = 1 where id = (select ruleset_version_id from public.test_versions where id = pg_temp.id('r34'))$$), '^42501 TRACE_GUARD: a preset needs its settings', 'settings U (DB-M1-7): a preset version without settings is refused');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'question_copy', 'off'))), 'OK 0', 'settings U: a workspace A2 recruiter cannot write a workspace A1 ruleset');
select pg_temp.u('reviewer');
select is(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'question_copy', 'off'))), 'OK 0', 'settings U: a reviewer cannot write settings');
select pg_temp.u('b_admin');
select is(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = pg_temp.id('t1_rs')$$, pg_temp.with_setting('strict', 'question_copy', 'off'))), 'OK 0', 'settings U: org B admin cannot write org A settings');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = (select ruleset_version_id from public.test_versions where id = pg_temp.id('vstd'))$$, pg_temp.with_setting('strict', 'question_copy', 'off'))), 'OK 0', 'settings U: a published ruleset is out of the update policy');
select pg_temp.op();
select matches(pg_temp.try($$update public.ruleset_versions set signal_settings = '{}' where id = (select ruleset_version_id from public.test_versions where id = pg_temp.id('r34'))$$), '^23514', 'settings (R5-39 c): a ruleset without settings keeps D1''s CHECK path');

-- ===== Publish with locks: E16 and R5-34 =====
select matches(pg_temp.try($$select pg_temp.publish('e16')$$), '^42501 TRACE_GUARD: setting locked by admin', 'E16: settings saved before a lock cannot be published against it');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.ruleset_versions set settings = %L where id = (select ruleset_version_id from public.test_versions where id = pg_temp.id('e16'))$$, pg_temp.with_setting('standard', 'paste_written', 'blocked'))), 'OK 1', 'E16: the draft is changed to the locked value');
select pg_temp.op();
select is(pg_temp.try($$select pg_temp.publish('e16')$$), 'OK 1', 'E16: then it publishes');
select matches(pg_temp.try($$select pg_temp.publish('w34')$$), '^42501 TRACE_GUARD: a written section''s paste rule follows the test''s paste setting', 'DB-M1-1: with paste locked to blocked, a written section that allows paste is refused at publish');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.sections set paste_rule = 'blocked' where id = '51000000-0000-4000-8000-0000000000c2'$$), 'OK 1', 'DB-M1-1: the recruiter aligns the section with the paste setting');
select pg_temp.op();
select is(pg_temp.try($$select pg_temp.publish('w34')$$), 'OK 1', 'DB-M1-1: then it publishes');
select matches(pg_temp.try($$select pg_temp.publish('r34')$$), '^42501 TRACE_GUARD: settings required while admin locks exist', 'R5-34: a draft without settings cannot dodge the org''s locks');
select pg_temp.u('admin');
select is(pg_temp.try($$delete from public.org_integrity_locks where id = 'e2000000-0000-4000-8000-000000000001'$$), 'OK 1', 'locks D: admin removes a lock');
select pg_temp.op();
select is((select pg_temp.keys(details) || '|' || (details ->> 'setting_key') from public.audit_log where action = 'integrity_lock.delete' and object_id = 'e2000000-0000-4000-8000-000000000001'), 'setting_key|paste_written', 'locks event: integrity_lock.delete carries the setting key only');
select is(pg_temp.try($$select pg_temp.publish('r34')$$), 'OK 1', 'R5-34 / R3-1: with no lock left, a D1-style draft publishes as D1');
select is((select package_version::text from public.test_versions where id = pg_temp.id('r34')), '1', 'R3-1: as package 1');

-- ===== R5-5 / R5-31 (I-M1-11, AT-M1-17 DB half): a flag for a switched-off signal is refused =====
select pg_temp.qcard('sess_std');
select pg_temp.qcard('sess_str');
select matches(pg_temp.flag('sess_std', 'D1-PASTE', 'paste', 'medium', false), '^42501 TRACE_GUARD: signal disabled by the test settings', 'R5-5: a paste flag on a Standard session (paste switched off) is refused for the integrity worker');
select is(pg_temp.flag('sess_str', 'D1-PASTE', 'paste', 'medium', false), 'OK 1', 'R5-5: the same flag on a Strict session (paste enabled) is accepted');
select is(pg_temp.flag('sess_std', 'X-COPY', 'paste', 'soft', false), 'OK 1', 'R5-31: a rule whose kind has no settings key counts as enabled');
select is(pg_temp.flag('sess_std', 'X-MIX', 'paste', 'soft', false), 'OK 1', 'R5-31: a rule with one enabled kind is accepted (refused only when every kind is off)');
select is(pg_temp.flag('sess_std', 'D1-UNTRUSTED-INPUT', 'input_origin', 'hard', true), 'OK 1', 'R5-5: an enabled signal on the same Standard session is accepted');
