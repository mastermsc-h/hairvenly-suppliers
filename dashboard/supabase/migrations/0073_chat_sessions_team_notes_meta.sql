-- Metadaten für Team-Notizen: wer und wann zuletzt bearbeitet
alter table chat_sessions
  add column if not exists team_notes_updated_at timestamptz,
  add column if not exists team_notes_updated_by uuid references profiles(id);
