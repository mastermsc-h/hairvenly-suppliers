-- Salon: qualitaet (russisch glatt / usbekisch wellig) pro Entnahme speichern.
alter table salon_entnahmen
  add column if not exists quality text;

create index if not exists salon_entnahmen_quality_idx on salon_entnahmen(quality);
