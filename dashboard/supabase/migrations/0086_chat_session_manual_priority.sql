-- Manuelle Priorität pro Session — MA kann eine Session als
-- HOCH / NORMAL / NIEDRIG markieren, was die Auto-Computed-Priorität
-- (Inbox Server-Side) überstimmt.
--
-- User-Wunsch 2026-05-27: "ich will die priorität aber auch selbst
-- ändern können im chat oder in der übersicht."
--
-- NULL = Auto-Mode (Server berechnet aus Triggern wie Foto, MA-Marker,
--        Wartezeit etc. — siehe inbox/page.tsx priorityMap).
-- 'high' | 'normal' | 'low' = explizit von MA gesetzt.

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS manual_priority TEXT
    CHECK (manual_priority IS NULL OR manual_priority IN ('high', 'normal', 'low'));

CREATE INDEX IF NOT EXISTS idx_chat_sessions_manual_priority
  ON chat_sessions(manual_priority)
  WHERE manual_priority IS NOT NULL;
