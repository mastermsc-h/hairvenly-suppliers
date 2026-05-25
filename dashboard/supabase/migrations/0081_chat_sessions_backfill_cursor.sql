-- Session-Level Backfill von Instagram-Conversation-Historie.
-- Mitarbeiter:innen können pro Session ältere Messages aus IG nachladen,
-- ohne zur IG-App wechseln zu müssen.
--
-- ig_conversation_id: gecached, damit wir nicht bei jedem "Mehr laden"-Klick
--   die Conversation-ID neu auflösen müssen (Meta /me/conversations?user_id=).
-- ig_messages_next_url: die opaque Pagination-URL die Meta uns nach dem
--   ersten Backfill-Call zurückgibt. Nächster Klick benutzt diese direkt.
--   Wenn NULL: noch nie ältere Messages geholt. Wenn leer-String '': keine
--   älteren mehr verfügbar.
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS ig_conversation_id  TEXT,
  ADD COLUMN IF NOT EXISTS ig_messages_next_url TEXT;
