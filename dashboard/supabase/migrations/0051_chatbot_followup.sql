-- Follow-Up-Tracking: einmaliges Nachhaken wenn Kunde sich nicht mehr meldet
alter table chat_sessions
  add column if not exists follow_up_sent_at  timestamptz,
  add column if not exists follow_up_status   text default 'pending'
    check (follow_up_status in ('pending', 'sent', 'responded', 'no_response', 'skipped')),
  add column if not exists follow_up_message  text;

create index if not exists idx_sessions_followup_status on chat_sessions(follow_up_status);
create index if not exists idx_sessions_followup_sent   on chat_sessions(follow_up_sent_at);
