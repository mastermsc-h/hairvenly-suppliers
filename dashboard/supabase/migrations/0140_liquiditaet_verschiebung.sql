-- Von Hand verschobene Zahltermine der Liquiditätsvorschau. Nur Planung: Rechnungen, Salden und
-- Ankunftsdaten bleiben unberührt.
--   art 'bestellung': schluessel = orders.id (Amanda-Zahlung)
--   art 'rate':       schluessel = Lieferantenname (nächste Rate; Folgeraten rutschen mit).
--                     letzte_zahlung = letzte Bankzahlung beim Verschieben; kommt eine neuere,
--                     ist die Rate bezahlt und die Verschiebung erledigt.
create table if not exists liquiditaet_verschiebung (
  art             text not null check (art in ('bestellung', 'rate')),
  schluessel      text not null,
  datum           date not null,
  notiz           text,
  letzte_zahlung  date,
  updated_at      timestamptz not null default now(),
  primary key (art, schluessel)
);

alter table liquiditaet_verschiebung enable row level security;
drop policy if exists "Admin read liquiditaet_verschiebung" on liquiditaet_verschiebung;
create policy "Admin read liquiditaet_verschiebung" on liquiditaet_verschiebung
  for select to authenticated using (is_admin());
-- Schreiben nur per service_role (Server Action mit requireFeature)
