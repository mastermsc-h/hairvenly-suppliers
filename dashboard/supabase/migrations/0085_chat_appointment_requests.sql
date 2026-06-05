-- Termin-Anfragen aus Chat — parallel zu chat_reservations.
--
-- Use-Case: Kundin schreibt im Instagram/WhatsApp/Web-Chat dass sie einen
-- Termin will (Beratung / Einarbeitung / Wartung etc.). Der Bot oder die
-- MA legt eine Termin-Anfrage an. MA bestätigt später mit konkretem Datum.
--
-- Architektur-Entscheidung: SEPARATE Tabelle, NICHT in chat_reservations
-- mit reservation_type-Discriminator gemischt. Begründung:
--   - Termin-Felder (Datum, Service, Slot) sind komplett anders als Produkt-
--     Felder (Linie, Länge, Methode, Farbe)
--   - Status-Lifecycle ist anders: Reservierung = waiting/notified/cancelled,
--     Termin = pending/confirmed/rescheduled/cancelled/completed
--   - Sauberer für künftige Treatwell-Kalender-Integration (sobald API verfügbar)

CREATE TABLE IF NOT EXISTS chat_appointment_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  customer_name   TEXT,
  channel         TEXT,                              -- 'instagram' | 'whatsapp' | 'web'
  external_id     TEXT,                              -- zum Senden

  -- Termin-Details
  service_type    TEXT NOT NULL CHECK (service_type IN (
    'beratung_neu',       -- Erstberatung
    'beratung_farbe',     -- Farbberatung mit Foto / Vor Ort
    'einarbeitung',       -- Extensions einarbeiten
    'wartung',            -- Wartung / Auffrischung
    'anpassung',          -- Schnitt / Anpassung
    'entfernung',         -- Extensions entfernen
    'sonstiges'           -- Other
  )),
  requested_date  DATE,                              -- Wunschdatum (kann NULL sein "demnächst")
  requested_time  TEXT,                              -- "vormittags" / "ab 14 Uhr" / "abends" (free-text)
  notes           TEXT,                              -- "Kundin hat dünnes Haar, will mehr Volumen"

  -- Status
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',            -- Neu, wartet auf MA
    'confirmed',          -- MA hat Termin bestätigt (mit konkretem Datum)
    'rescheduled',        -- Wurde verschoben
    'cancelled',          -- Storniert
    'completed'           -- Termin hat stattgefunden
  )),
  confirmed_at    TIMESTAMPTZ,
  confirmed_by    UUID REFERENCES profiles(id),
  confirmed_date  TIMESTAMPTZ,                       -- konkreter Termin-Slot wenn confirmed
  confirmation_message TEXT,                         -- was MA an Kundin gesendet hat

  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES profiles(id),
  cancel_reason   TEXT,

  completed_at    TIMESTAMPTZ,
  completed_by    UUID REFERENCES profiles(id),

  requested_at    TIMESTAMPTZ DEFAULT NOW(),
  created_by_bot  BOOLEAN DEFAULT TRUE,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_status_requested
  ON chat_appointment_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_session
  ON chat_appointment_requests(session_id);

ALTER TABLE chat_appointment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "appointments_admin" ON chat_appointment_requests FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

CREATE OR REPLACE FUNCTION update_appointments_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_updated_at ON chat_appointment_requests;
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON chat_appointment_requests
  FOR EACH ROW EXECUTE FUNCTION update_appointments_updated_at();
