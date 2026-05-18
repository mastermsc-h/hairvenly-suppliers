-- Auto-Kategorisierung pro Session
-- Wird beim Eingang einer Kundennachricht via Haiku gesetzt
alter table chat_sessions
  add column if not exists category text
    check (category in (
      'availability',  -- Verfügbarkeit / Lagerfrage
      'pricing',       -- Preis / Kosten
      'color_advice',  -- Farbberatung / welche Farbe passt
      'appointment',   -- Termin / Salon-Buchung
      'complaint',     -- Reklamation / Beschwerde
      'order_status',  -- Bestellstatus / wo ist meine Bestellung
      'partnership',   -- B2B / Kooperation / Lieferant-Anfragen
      'general'        -- Sonstiges / unklar
    ));

create index if not exists idx_sessions_category on chat_sessions(category) where category is not null;
