-- Add 'packing_details' kind (EN: Packing Details / DE: Paketübersicht)
-- Idempotent: only add if it doesn't already exist.
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'document_kind' and e.enumlabel = 'packing_details'
  ) then
    alter type document_kind add value 'packing_details';
  end if;
end $$;
