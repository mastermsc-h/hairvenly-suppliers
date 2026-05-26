-- Strukturierte Felder für chat_reservations.
--
-- User-Wunsch 2026-05-27: "Eingabemaske verbessern, damit in zukunft immer
-- erforderliche Angaben haben. Z.B. per Dropdown Russisch oder Usbekisch,
-- die Länge, und die Methode? Mit der automatischen Erkennung soll er
-- schon mal das ausfüllen, was er erkannt hat, dann die Maske einblenden,
-- sodass der Mitarbeiter den Rest auswählt (falls dem Bot Informationen fehlen)."
--
-- Architektur: Free-text Felder (product_name, method, color) BLEIBEN als
-- Display-Layer. Strukturierte Felder werden für den LAGER-MATCHER benutzt
-- — sind die Felder gesetzt (structured_complete=true), nutzt der Matcher
-- nur diese und ignoriert die Heuristik-Suche. Sind sie unvollständig,
-- bleibt der bestehende Free-Text-Match aktiv (Fallback).

ALTER TABLE chat_reservations
  ADD COLUMN IF NOT EXISTS line TEXT
    CHECK (line IS NULL OR line IN ('russisch', 'usbekisch'));

ALTER TABLE chat_reservations
  ADD COLUMN IF NOT EXISTS length_cm INTEGER
    CHECK (length_cm IS NULL OR length_cm IN (45, 55, 60, 65, 85));

ALTER TABLE chat_reservations
  ADD COLUMN IF NOT EXISTS method_kind TEXT
    CHECK (method_kind IS NULL OR method_kind IN (
      'tape', 'mini_tape', 'genius_weft', 'classic_weft', 'invisible_weft',
      'bonding', 'clip', 'ponytail'
    ));

ALTER TABLE chat_reservations
  ADD COLUMN IF NOT EXISTS structured_complete BOOLEAN NOT NULL DEFAULT false;

-- Bestehende Reservierungen behalten structured_complete=false →
-- alter Free-Text-Matcher bleibt aktiv bis MA via Modal nachträgt.

CREATE INDEX IF NOT EXISTS idx_reservations_structured
  ON chat_reservations(structured_complete) WHERE status = 'waiting';
