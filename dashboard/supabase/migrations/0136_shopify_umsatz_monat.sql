-- Shopify-Umsatz je Kalendermonat (deutsche Zeit) für die Finanzübersicht.
-- Eigene Tabelle statt shopify_monthly_revenue: deren Sync im Sammel-Cron wurde seit
-- 03.09.2026 regelmäßig aus Zeitgründen übersprungen (Juli 2026 stand bei 168 €).
create table if not exists shopify_umsatz_monat (
  monat         text primary key check (monat ~ '^\d{4}-\d{2}$'),
  brutto        numeric(14,2) not null,   -- Bestellsummen inkl. USt + Versand, ohne Stornos/Tests
  erstattet     numeric(14,2) not null,   -- Erstattungen auf diese Bestellungen
  netto         numeric(14,2) not null,   -- brutto − erstattet (= Umsatz für die Übersicht)
  bestellungen  int not null,
  kanaele       jsonb not null default '{}'::jsonb,  -- brutto je Kanal (Online, Kasse, Entwurf …)
  stand         timestamptz not null default now()
);

alter table shopify_umsatz_monat enable row level security;
drop policy if exists "Admin read shopify_umsatz_monat" on shopify_umsatz_monat;
create policy "Admin read shopify_umsatz_monat" on shopify_umsatz_monat
  for select to authenticated using (is_admin());
-- Schreiben nur per service_role (Cron / Server Action)
