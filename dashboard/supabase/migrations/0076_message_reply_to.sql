-- Reply-Threading: speichert die mid (external_id) der Nachricht, auf die
-- diese Nachricht eine direkte Antwort ist. Meta IG-Webhook liefert das im
-- Feld message.reply_to.mid bei Replies. So können wir im UI wie auf
-- Instagram einen kleinen "Antwort auf: ..." Hinweis über der Bubble zeigen.
alter table chat_messages
  add column if not exists reply_to_external_id text;

create index if not exists idx_chat_messages_reply_to_ext
  on chat_messages (reply_to_external_id)
  where reply_to_external_id is not null;
