-- Freestyle-Einnahmen: Mitarbeiter im Laden/Salon erfassen ihre Einnahmen am iPad/iPhone
-- (/salon/einnahme, Identifikation per 6-stelliger PIN aus salon_employees).
-- Auswertung nur für den Admin (/salon-admin/einnahmen). Keine authenticated-Policy:
-- Lesen/Schreiben ausschließlich über service_role (Server Actions mit Rollen-Check).

create table if not exists salon_einnahme_arten (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  bereich text not null check (bereich in ('verkauf', 'salon')),
  sortierung int not null default 100,
  aktiv boolean not null default true,
  created_at timestamptz not null default now()
);
alter table salon_einnahme_arten enable row level security;

create table if not exists salon_einnahmen (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references salon_employees(id),
  art_id uuid references salon_einnahme_arten(id),
  -- Schnappschuss: Umbenennen/Verschieben einer Art ändert alte Einträge nicht
  art_name text not null,
  bereich text not null check (bereich in ('verkauf', 'salon')),
  betrag numeric(10, 2) not null check (betrag > 0 and betrag < 100000),
  zeitpunkt timestamptz not null default now(),
  notiz text check (notiz is null or length(notiz) <= 500),
  storniert_am timestamptz,
  storniert_von text check (storniert_von is null or storniert_von in ('mitarbeiter', 'admin')),
  created_at timestamptz not null default now()
);
alter table salon_einnahmen enable row level security;
create index if not exists salon_einnahmen_zeitpunkt on salon_einnahmen (zeitpunkt);
create index if not exists salon_einnahmen_employee on salon_einnahmen (employee_id, zeitpunkt);

-- PIN-Fehlversuche (Sperre gegen Durchprobieren)
create table if not exists salon_pin_versuche (
  id bigint generated always as identity primary key,
  ok boolean not null,
  zweck text not null,
  created_at timestamptz not null default now()
);
alter table salon_pin_versuche enable row level security;
create index if not exists salon_pin_versuche_zeit on salon_pin_versuche (created_at);

insert into salon_einnahme_arten (name, bereich, sortierung)
select v.name, v.bereich, v.sortierung
from (values
  ('Extensions (Ware)', 'verkauf', 10),
  ('Pflege & Zubehör', 'verkauf', 20),
  ('Extensions einsetzen', 'salon', 110),
  ('Hochsetzen', 'salon', 120),
  ('Entfernen', 'salon', 130),
  ('Färben / Balayage / Strähnen', 'salon', 140),
  ('Schnitt & Styling', 'salon', 150),
  ('Augenbrauen & Wimpern', 'salon', 160),
  ('Sonstiges', 'salon', 190)
) as v(name, bereich, sortierung)
where not exists (select 1 from salon_einnahme_arten);
