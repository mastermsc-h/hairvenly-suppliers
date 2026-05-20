-- "Nur für Team" Flag: Mitarbeiter kann eine Session explizit kennzeichnen
-- so dass der Bot dort nicht mehr antwortet. Anders als bot_mode='off' ist das
-- eine bewusste, langfristige Entscheidung — Bot bleibt OFF auch bei zukünftigen
-- Kundennachrichten, bis der Mitarbeiter die Markierung wieder entfernt.
alter table chat_sessions
  add column if not exists human_only boolean not null default false;

create index if not exists idx_sessions_human_only
  on chat_sessions(human_only) where human_only = true;
