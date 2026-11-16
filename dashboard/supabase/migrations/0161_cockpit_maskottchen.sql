-- Startbildschirm: gewähltes Maskottchen je Benutzer (eigene Spalte, damit das Speichern
-- der Anordnung es nicht überschreibt).
alter table cockpit_layout add column if not exists maskottchen text;
