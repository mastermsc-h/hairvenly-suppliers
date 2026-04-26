-- Realtime aktivieren für Pack-Tabellen, damit iMac-Display live updates bekommt.
-- Ohne das schickt Supabase keine postgres_changes events an Browser-Subscriptions.

alter publication supabase_realtime add table pack_sessions;
alter publication supabase_realtime add table pack_scans;

-- REPLICA IDENTITY FULL: damit auch UPDATE-events alle Spalten enthalten
-- (sonst nur Primärschlüssel — wir brauchen den Status für die Display-Logik).
alter table pack_sessions replica identity full;
alter table pack_scans replica identity full;
