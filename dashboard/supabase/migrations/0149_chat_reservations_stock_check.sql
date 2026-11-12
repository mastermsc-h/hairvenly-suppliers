-- Täglicher Lager-Check der Chatbot-Warteliste.
--
-- Der Cron /api/cron/reservations-check (und der Button „Lager-Check" auf
-- /chatbot/reservations) prüft jede wartende Reservierung gegen die
-- Stock-Sheets und speichert das Ergebnis hier. Sidebar-Badge und Hervorhebung
-- lesen nur diese Spalten — es wird NICHTS automatisch an Kundinnen gesendet.
--
-- in_stock_since: seit wann die Ware (wieder) vorrätig erkannt ist; bleibt bei
-- erneuten Checks stehen, wird geleert sobald sie nicht mehr vorrätig ist.
-- Rein additiv (nullable Spalten) — Rollback: Spalten droppen.

ALTER TABLE chat_reservations
  ADD COLUMN IF NOT EXISTS last_stock_status text
    CHECK (last_stock_status IN ('in_stock', 'unterwegs', 'out_of_stock', 'unknown', 'service_item')),
  ADD COLUMN IF NOT EXISTS last_stock_eta text,
  ADD COLUMN IF NOT EXISTS last_stock_match text,
  ADD COLUMN IF NOT EXISTS last_stock_reason text,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS in_stock_since timestamptz;

-- Badge-Zählung: wartend + vorrätig
CREATE INDEX IF NOT EXISTS chat_reservations_waiting_in_stock_idx
  ON chat_reservations (status, last_stock_status)
  WHERE status = 'waiting';
