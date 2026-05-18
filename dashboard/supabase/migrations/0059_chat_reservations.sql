-- Wartelisten-Reservierungen: Kunde will benachrichtigt werden wenn Ware da
-- Bot legt sie an (über neues Tool), Mitarbeiter klickt später "benachrichtigen"
create table if not exists chat_reservations (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references chat_sessions(id) on delete cascade,
  customer_name   text,
  channel         text,                                    -- 'instagram' | 'whatsapp' | 'web'
  external_id     text,                                    -- zum Senden

  product_name    text not null,                           -- z.B. "EBONY Russisch Standard Tapes"
  product_url     text,                                    -- shopify_url falls bekannt
  color           text,
  method          text,                                    -- "Standard Tapes" / "Bondings" / ...
  eta_hint        text,                                    -- "Anfang Juni" / "ca. 04.06.2026" / null
  notes           text,                                    -- free-text z.B. "Kundin braucht für Hochzeit am 15.06"

  status          text not null default 'waiting'
                  check (status in ('waiting', 'notified', 'cancelled')),
  requested_at    timestamptz default now(),

  notified_at     timestamptz,
  notified_by     uuid references profiles(id),
  notification_message text,                               -- was wir tatsächlich gesendet haben

  cancelled_at    timestamptz,
  cancelled_by    uuid references profiles(id),
  cancel_reason   text,

  created_by_bot  boolean default true,                    -- false = manuell vom Mitarbeiter angelegt
  updated_at      timestamptz default now()
);

create index if not exists idx_reservations_status_requested
  on chat_reservations(status, requested_at desc);
create index if not exists idx_reservations_session
  on chat_reservations(session_id);

alter table chat_reservations enable row level security;
create policy "reservations_admin" on chat_reservations for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

create or replace function update_reservations_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists reservations_updated_at on chat_reservations;
create trigger reservations_updated_at before update on chat_reservations
  for each row execute function update_reservations_updated_at();
