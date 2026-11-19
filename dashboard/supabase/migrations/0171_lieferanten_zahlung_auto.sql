-- Überweisungen an Lieferanten (Ebru/Amanda) aus den Kontoumsätzen automatisch als Zahlung eintragen.
-- payments.bank_transaction_id: Herkunft einer automatisch eingetragenen Zahlung.
-- bank_transactions.lieferant_zahlung: Verarbeitungsstand — einmal verarbeitet, nie wieder
-- (auch wenn die Zahlung später von Hand gelöscht wird).
alter table public.payments add column if not exists bank_transaction_id uuid references public.bank_transactions(id) on delete set null;
alter table public.payments add column if not exists auto_added boolean not null default false;
create unique index if not exists payments_bank_transaction_id_uq on public.payments(bank_transaction_id) where bank_transaction_id is not null;

alter table public.bank_transactions add column if not exists lieferant_zahlung text;          -- gebucht | vorhanden | unklar
alter table public.bank_transactions add column if not exists lieferant_zahlung_info jsonb;
