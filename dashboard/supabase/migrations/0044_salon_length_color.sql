-- Salon: laenge + farbe pro Entnahme speichern (fuer Statistik-Aggregation)
alter table salon_entnahmen
  add column if not exists length_cm int,
  add column if not exists color text;

create index if not exists salon_entnahmen_length_idx on salon_entnahmen(length_cm);
create index if not exists salon_entnahmen_color_idx on salon_entnahmen(color);
