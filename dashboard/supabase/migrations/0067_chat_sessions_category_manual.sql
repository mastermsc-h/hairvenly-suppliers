-- Manuelles Override-Flag für Kategorie:
-- Wenn der Mitarbeiter die Kategorie manuell setzt, soll der Auto-Klassifizierer
-- (der bei jeder eingehenden Kundennachricht läuft) die Wahl nicht mehr
-- überschreiben. Bisher hat jede neue Nachricht das manuelle Tag platt gemacht.
alter table chat_sessions
  add column if not exists category_manual boolean not null default false;
