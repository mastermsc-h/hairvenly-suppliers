-- Bestellzyklus-Reminder pro Lieferant.
--
-- Konzept: pro Lieferant wird ein Start-Datum + Intervall in Tagen
-- konfiguriert. Daraus berechnet sich der aktuelle Zyklus-Start:
--   current_cycle_start = größter Wert (start + k*interval) <= today
-- Wenn seit current_cycle_start keine neue Bestellung für diesen
-- Lieferanten angelegt wurde → Reminder ist fällig.
--
-- Felder:
--   order_cycle_enabled       true → Reminder aktiv
--   order_cycle_start_date    Anker-Datum, ab dem das Raster läuft
--   order_cycle_interval_days Intervall (Standard 14 = alle 2 Wochen)
--   order_cycle_last_reminded letzte gesendete Reminder-Mail (für Logging
--                             und um nicht mehrfach am selben Tag zu schicken)

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS order_cycle_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_cycle_start_date date,
  ADD COLUMN IF NOT EXISTS order_cycle_interval_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS order_cycle_last_reminded date;

COMMENT ON COLUMN suppliers.order_cycle_enabled IS
  'Wenn true wird der tägliche Reminder-Job einen Eintrag für diesen Lieferanten prüfen.';
COMMENT ON COLUMN suppliers.order_cycle_start_date IS
  'Anker-Datum: ab hier wird im Intervall (order_cycle_interval_days) gerechnet. NULL = noch nicht konfiguriert.';
COMMENT ON COLUMN suppliers.order_cycle_interval_days IS
  'Tage zwischen Zyklen, Default 14 = alle 2 Wochen.';
COMMENT ON COLUMN suppliers.order_cycle_last_reminded IS
  'Datum der letzten Reminder-Mail (Idempotenz: gleicher Tag → kein erneuter Versand).';
