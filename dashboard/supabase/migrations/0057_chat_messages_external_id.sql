-- Dedup-Spalte für Sync aus Graph API (Instagram-Message-ID)
alter table chat_messages
  add column if not exists external_id text;

create unique index if not exists chat_messages_session_external_uidx
  on chat_messages(session_id, external_id) where external_id is not null;
