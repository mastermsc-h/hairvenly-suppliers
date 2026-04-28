-- Add 'stocked' (Ins Lager eingepflegt) as a final status after 'delivered'.
-- After this status the order is treated as archived.
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'order_status' and e.enumlabel = 'stocked'
  ) then
    alter type order_status add value 'stocked' after 'delivered';
  end if;
end $$;
