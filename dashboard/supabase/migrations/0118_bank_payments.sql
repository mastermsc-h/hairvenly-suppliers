-- Zahlungsabgleich Vorkasse: Kontoumsätze (Sparkasse via FinTS-Worker oder CSV)
-- werden gegen offene Shopify-Bestellungen gematcht. Sichere Treffer
-- (Bestellnummer im Verwendungszweck + exakter Betrag) markiert das System
-- als bezahlt — aber erst, wenn der Modus von 'shadow' auf 'live' steht.
--
-- Wahrheitsquelle für "bezahlt" bleibt Shopify: vor jedem orderMarkAsPaid wird
-- der Live-Status der Bestellung neu gelesen. Dadurch kann auch ein doppelt
-- importierter Umsatz nie zu einer doppelten Aktion führen.

create table if not exists bank_transactions (
  id                uuid primary key default gen_random_uuid(),
  -- Stabiler Schlüssel gegen Doppel-Import (überlappende Abrufzeiträume)
  dedupe_key        text not null unique,
  source            text not null check (source in ('fints', 'csv')),
  account_iban      text,
  booking_date      date not null,
  value_date        date,
  amount            numeric(12,2) not null,           -- + Eingang, − Ausgang
  currency          text not null default 'EUR',
  counterparty_name text,
  counterparty_iban text,
  purpose           text,
  posting_text      text,
  end_to_end_ref    text,

  -- Abgleich
  match_status      text not null default 'pending'
                    check (match_status in (
                      'pending',      -- neu, noch nicht abgeglichen
                      'processing',   -- gerade in Bearbeitung (Claim gegen Parallel-Läufe)
                      'shadow',       -- sicherer Treffer, Modus shadow → keine Aktion
                      'auto_paid',    -- sicherer Treffer, automatisch als bezahlt markiert
                      'manual_paid',  -- von Mensch bestätigt + als bezahlt markiert
                      'review',       -- muss geprüft werden
                      'ignored',      -- keine Bestellzahlung (Auszahlung, privat, …)
                      'debit'         -- Ausgang, wird nicht gematcht
                    )),
  match_reason      text,               -- maschineller Grund (z.B. amount_mismatch)
  match_detail      text,               -- lesbarer Zusatz
  matched_orders    jsonb not null default '[]'::jsonb,  -- [{gid,name,outstanding}]
  candidates        jsonb not null default '[]'::jsonb,  -- Vorschläge für review
  marked_paid_at    timestamptz,
  resolved_by       uuid references profiles(id) on delete set null,
  resolved_at       timestamptz,
  raw               jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists bank_tx_booking_idx on bank_transactions (booking_date desc);
create index if not exists bank_tx_status_idx  on bank_transactions (match_status);

alter table bank_transactions enable row level security;

-- Bankdaten sind sensibel: nur Admins/Mitarbeiter. Feature-Gate (finances)
-- zusätzlich in der App. Der Ingest-Endpoint schreibt mit service_role.
create policy "Admin read bank_transactions" on bank_transactions
  for select to authenticated using (is_admin());
create policy "Admin manage bank_transactions" on bank_transactions
  for all to authenticated using (is_admin()) with check (is_admin());

create or replace function set_bank_transactions_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_bank_transactions_updated_at on bank_transactions;
create trigger trg_bank_transactions_updated_at
  before update on bank_transactions
  for each row execute function set_bank_transactions_updated_at();

-- ---------------------------------------------------------------------------
-- Sync-Zustand + Feature-Flag (genau eine Zeile)
-- ---------------------------------------------------------------------------
create table if not exists bank_sync_state (
  id                 int primary key default 1 check (id = 1),
  -- off    = nur speichern, kein Abgleich
  -- shadow = abgleichen + anzeigen, aber Shopify NICHT ändern (Start-Modus)
  -- live   = sichere Treffer automatisch als bezahlt markieren
  auto_mark_mode     text not null default 'shadow'
                     check (auto_mark_mode in ('off', 'shadow', 'live')),
  last_fetch_at      timestamptz,          -- letzter Kontakt des Workers
  last_fetch_ok      boolean,
  last_fetch_code    text,                 -- ok | needs_tan | error | …
  last_fetch_message text,
  last_success_at    timestamptz,          -- letzter erfolgreicher Umsatzabruf
  last_alert_at      timestamptz,          -- letzte Warn-Mail (max. 1× täglich)
  updated_at         timestamptz not null default now()
);

insert into bank_sync_state (id) values (1) on conflict (id) do nothing;

alter table bank_sync_state enable row level security;
create policy "Admin read bank_sync_state" on bank_sync_state
  for select to authenticated using (is_admin());
create policy "Admin manage bank_sync_state" on bank_sync_state
  for all to authenticated using (is_admin()) with check (is_admin());
