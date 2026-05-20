-- Manuelles Follow-Up: Mitarbeiter markiert eine Session zur späteren
-- Nachverfolgung (z.B. "in 3 Tagen fragen ob sie gekauft hat"). Anders als
-- der existierende follow_up_status (automatisch nach 3 Tagen Stille) ist
-- das ein explizit gesetztes Wiedervorlage-Datum.
alter table chat_sessions
  add column if not exists followup_due_at timestamptz,
  add column if not exists followup_reason text;

create index if not exists idx_sessions_followup_due
  on chat_sessions(followup_due_at) where followup_due_at is not null;
