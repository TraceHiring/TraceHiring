-- MT-9.extension_owner: lo is a trusted extension that is not on the supautils privileged list, so postgres can
-- create it and owns it. The owner of an extension can ALTER EXTENSION … ADD any object it owns, which hides that
-- object from every check as an extension member. Trace never installs lo.
create extension lo with schema extensions;
