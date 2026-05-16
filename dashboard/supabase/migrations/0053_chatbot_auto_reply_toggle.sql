-- Per-Session Toggle: Bot soll automatisch antworten oder nur empfangen?
-- Default: false für instagram/whatsapp (manuell aktivieren bis Production)
--          true für web (Test-Widget)
alter table chat_sessions
  add column if not exists bot_auto_reply boolean default false;

-- Bestehende Web-Sessions: Bot war default aktiv → setzen
update chat_sessions set bot_auto_reply = true where channel = 'web' and bot_auto_reply = false;

-- Index für schnelles Filtern
create index if not exists idx_sessions_auto_reply on chat_sessions(bot_auto_reply);
