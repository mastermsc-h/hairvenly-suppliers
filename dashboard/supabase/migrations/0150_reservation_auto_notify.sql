-- Automatische Wartelisten-Benachrichtigung (Kundin bekommt DM, sobald die
-- reservierte Variante eindeutig wieder auf Lager ist).
--
-- Schalter chatbot_settings.reservation_auto_notify:
--   off    → nichts automatisch (Verhalten wie vorher)
--   shadow → Probelauf: Cron entscheidet + zeigt „würde benachrichtigt", sendet NICHT
--   live   → Cron sendet (Mo–Sa 10 Uhr Berlin, max. 30 Nachrichten/Lauf)
-- Start in shadow. Rollback: Schalter auf off.
--
-- Pro Reservierung:
--   auto_notify_decision/-reason  Entscheidung des letzten Checks (would_send|skip)
--   notified_auto                 true = vom Cron benachrichtigt (notified_by bleibt null)
--   notify_attempts, last_notify_attempt_at, last_notify_error
--                                 Fehlversuche (max. 3, an verschiedenen Tagen)
--   notify_lock_until             Versand-Sperre: wer sie per UPDATE … WHERE setzt,
--                                 darf senden → genau einmal, auch bei parallelen Läufen

ALTER TABLE chatbot_settings
  ADD COLUMN IF NOT EXISTS reservation_auto_notify text NOT NULL DEFAULT 'shadow'
    CHECK (reservation_auto_notify IN ('off', 'shadow', 'live'));

ALTER TABLE chat_reservations
  ADD COLUMN IF NOT EXISTS auto_notify_decision text
    CHECK (auto_notify_decision IN ('would_send', 'skip')),
  ADD COLUMN IF NOT EXISTS auto_notify_reason text,
  ADD COLUMN IF NOT EXISTS notified_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_notify_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_notify_error text,
  ADD COLUMN IF NOT EXISTS notify_lock_until timestamptz;
