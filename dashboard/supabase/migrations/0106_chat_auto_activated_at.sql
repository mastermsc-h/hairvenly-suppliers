-- auto_activated_at: Zeitpunkt, zu dem die MA den Autobot (auto/selective_auto)
-- für diese Session BEWUSST (wieder) aktiviert hat. Der MA-Aktiv-Guard
-- ("Grätsch-Schutz") blockiert den Autobot nur, wenn die letzte manuelle
-- Mitarbeiter-Antwort NEUER ist als dieser Zeitpunkt. Drückt die MA erneut auf
-- "Auto-Antwort", wird auto_activated_at aktualisiert → Schutz bewusst aufgehoben.
alter table public.chat_sessions
  add column if not exists auto_activated_at timestamptz;
