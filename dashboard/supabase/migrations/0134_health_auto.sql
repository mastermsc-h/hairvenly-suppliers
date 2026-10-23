-- Firmen-Gesundheit automatisch: Konten aus bank_salden (FinTS/PayPal), Schulden aus Bestellungen
-- (echte Schuld laut order-debt) + offenen Steuer-Soll-Posten. Manuell nur noch Ergänzungen
-- (weitere Schulden, Steuer-Rückstellung). details = vollständige Aufschlüsselung des Eintrags.
alter table company_health_snapshots add column if not exists details jsonb;
alter table company_health_snapshots add column if not exists auto boolean not null default false;
comment on column company_health_snapshots.treatwell_eur is 'Salon-Konto (Sparkasse …6001)';
comment on column company_health_snapshots.shopify_eur is 'Shop-Konto (Sparkasse …6019) + PayPal';
comment on column company_health_snapshots.targobank_eur is 'Targobank-Gehaltskonto';
comment on column company_health_snapshots.debt_eur is 'Schulden gesamt (Lieferanten fällig + Steuern offen + Ergänzungen)';
