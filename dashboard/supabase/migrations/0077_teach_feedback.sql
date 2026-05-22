-- Tracking: wann/wer hat eine Autobot-Message nachtrainiert?
-- Verhindert doppelte Trainings auf derselben Message + zeigt im UI an,
-- dass für diese Antwort schon Feedback abgegeben wurde.
alter table chat_messages
  add column if not exists teach_feedback_at  timestamptz,
  add column if not exists teach_feedback_by  uuid references profiles(id) on delete set null;

create index if not exists idx_chat_messages_teach_feedback
  on chat_messages (teach_feedback_at)
  where teach_feedback_at is not null;
