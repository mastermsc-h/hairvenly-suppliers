-- Recall-Sync: wenn IG-User (Kundin oder wir) eine Nachricht zurückruft,
-- speichert Webhook das hier statt physisch zu löschen — Audit-Trail bleibt.
alter table chat_messages
  add column if not exists deleted_at timestamptz;

create index if not exists idx_chat_messages_session_not_deleted
  on chat_messages(session_id, created_at)
  where deleted_at is null;
