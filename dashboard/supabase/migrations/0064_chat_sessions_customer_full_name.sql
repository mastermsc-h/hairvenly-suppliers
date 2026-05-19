-- Echter Name des Kunden (z.B. "Maria Müller") zusätzlich zum @username
-- Hilft Mitarbeiter:innen wenn sie im IG-Manager den Namen sehen aber im
-- Dashboard nur "@apfel.me" — Verwechslungs-Risiko.
alter table chat_sessions
  add column if not exists customer_full_name text;
