-- 'manual' (Manuell): manuelle Position, z.B. Sammelrechnung über mehrere (ausgeblendete) Bestellungen.
-- Keine Ware unterwegs, sofort echte Schuld; Zahlplan (Raten/Frist) rechnet die Liquiditätsvorschau.
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'order_status' and e.enumlabel = 'manual'
  ) then
    alter type order_status add value 'manual' after 'cancelled';
  end if;
end $$;
