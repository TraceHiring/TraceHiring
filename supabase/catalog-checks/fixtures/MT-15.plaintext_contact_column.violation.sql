-- MT-15.plaintext_contact_column: an in-scope table with a plaintext-shaped phone column (no _ct, _bidx, _hint or _hmac suffix).
create table public.mt_15_people (org_id uuid not null, phone_number text);
