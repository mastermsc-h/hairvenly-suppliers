-- Notizen-Feld für Pack-Sessions (z.B. "Karton beschädigt", "Kunde hat angerufen")
alter table pack_sessions
  add column if not exists notes text;
