-- MT-9.handmade_in_extensions: a function created as postgres in schema extensions that is not an extension member.
create function extensions.mt_9_helper() returns integer language sql as 'select 1';
