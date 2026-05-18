-- Bot-Begleitung: Bot generiert Entwurf, Mitarbeiter approved/editiert vor Versand
-- Modus pro Session: 'auto' (sendet direkt), 'assisted' (Entwurf), 'off' (nichts)

alter table chat_sessions
  add column if not exists bot_mode text not null default 'auto'
    check (bot_mode in ('auto', 'assisted', 'off'));

-- Migration: bestehendes bot_auto_reply → bot_mode
update chat_sessions
  set bot_mode = case when bot_auto_reply then 'auto' else 'off' end
  where bot_mode = 'auto';

-- Tabelle: Entwürfe die auf Freigabe warten
create table if not exists chat_drafts (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references chat_sessions(id) on delete cascade,
  original_text   text not null,                         -- was der Bot ursprünglich vorschlug
  edited_text     text,                                  -- vom Mitarbeiter editiert (null = unverändert)
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'discarded')),
  tool_calls      jsonb,                                 -- Tool-Aufrufe vom Bot (für Re-Use)
  tool_results    jsonb,
  trigger_message_id uuid references chat_messages(id) on delete set null,  -- welche User-Msg den Bot triggerte
  created_at      timestamptz default now(),
  approved_at     timestamptz,
  approved_by     uuid references profiles(id)
);

create index if not exists idx_chat_drafts_session_pending
  on chat_drafts(session_id, status)
  where status = 'pending';

create index if not exists idx_chat_drafts_status
  on chat_drafts(status, created_at desc);

alter table chat_drafts enable row level security;
create policy "drafts_admin" on chat_drafts for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);
