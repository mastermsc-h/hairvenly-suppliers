-- 0096: Performance-Indizes für die Chat-Inbox-Übersicht
--
-- Problem (gemessen 02.06): Das Öffnen der Inbox-Übersicht dauerte mehrere
-- Sekunden. Ursache: `count(*) WHERE status='active'` brauchte bei kaltem
-- Cache 3-4s (active-Rows verstreut über die Tabelle → großer Scan), plus die
-- nach last_message_at sortierte Hauptliste.
--
-- Fix:
-- 1) Partieller Index nur für active-Sessions → count(active) wird index-only
--    und winzig (gemessen: 4279ms → 20ms).
-- 2) Composite (status, last_message_at DESC) für die sortierte Hauptliste
--    (status != closed, order by last_message_at).

CREATE INDEX IF NOT EXISTS idx_sessions_active_partial
  ON chat_sessions (id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_sessions_status_lastmsg
  ON chat_sessions (status, last_message_at DESC);
