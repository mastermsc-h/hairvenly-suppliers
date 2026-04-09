-- Supplier profile fields (contact + banking)
alter table public.suppliers
  add column if not exists address       text,
  add column if not exists email         text,
  add column if not exists phone         text,
  add column if not exists bank_name     text,
  add column if not exists bank_account_holder text,
  add column if not exists bank_address  text,
  add column if not exists iban          text,
  add column if not exists swift_bic     text,
  add column if not exists profile_notes text;
