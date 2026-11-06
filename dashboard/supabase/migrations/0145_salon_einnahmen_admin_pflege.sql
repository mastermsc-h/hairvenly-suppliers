-- Einnahmen auch vom Admin am Rechner pflegen (/salon-admin/einnahmen):
-- nachtragen ohne PIN und bestehende Einträge korrigieren — nachvollziehbar.

alter table salon_einnahmen
  add column if not exists erfasst_von text not null default 'mitarbeiter'
    check (erfasst_von in ('mitarbeiter', 'admin')),
  add column if not exists geaendert_am timestamptz,
  -- Stand vor der ersten Admin-Änderung (Mitarbeiter-Eingabe), wird nur einmal gesetzt
  add column if not exists original jsonb;
