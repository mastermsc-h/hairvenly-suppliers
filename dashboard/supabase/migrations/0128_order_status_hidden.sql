-- 'hidden' (Ausgeblendet): Bestellung ist erledigt und soll aus allen aktiven Ansichten
-- verschwinden, unabhängig von Rechnung/Restbetrag (z.B. Sammelrechnung über mehrere Bestellungen).
-- Landet im Archiv und kann dort jederzeit zurückgesetzt werden.
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'order_status' and e.enumlabel = 'hidden'
  ) then
    alter type order_status add value 'hidden' after 'cancelled';
  end if;
end $$;
