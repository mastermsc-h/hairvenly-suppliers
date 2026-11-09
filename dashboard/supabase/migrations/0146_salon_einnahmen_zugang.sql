-- Einnahmen-App nur für ausgewählte Mitarbeiter (Admin schaltet je Person frei).
-- „Ware entnehmen“ am Salon-iPad bleibt für alle aktiven Mitarbeiter unverändert.
alter table salon_employees
  add column if not exists einnahmen_erlaubt boolean not null default false;

-- employee_id = wer die Einnahme gemacht hat (in der App auswählbar),
-- erfasst_durch = wer sie mit seiner PIN eingetragen hat (null = Admin am Rechner bzw. Altbestand)
alter table salon_einnahmen
  add column if not exists erfasst_durch uuid references salon_employees(id);
