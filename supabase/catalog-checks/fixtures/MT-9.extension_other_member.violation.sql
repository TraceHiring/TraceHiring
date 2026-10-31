-- MT-9.extension_other_member: postgres owns lo (see MT-9.extension_owner) and adds a text search configuration it
-- made to it. No check reads pg_ts_config, so a member there is flagged for any extension postgres controls.
-- extension_owner fires too. Trace never installs lo.
create extension lo with schema extensions;
create text search configuration extensions.mt_9_config (copy = pg_catalog.simple);
alter extension lo add text search configuration extensions.mt_9_config;
