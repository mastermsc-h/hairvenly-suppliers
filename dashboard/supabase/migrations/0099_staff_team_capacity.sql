-- Mitarbeiter-Management Teil 2: Team-Mindestbesetzung, Azubis, Geburtstage.

-- Azubi-Kennzeichnung + Geburtsdatum am Mitarbeiter.
alter table staff_members add column if not exists is_trainee boolean not null default false;
alter table staff_members add column if not exists birth_date date;

-- Pro Team: wie viele Mitarbeiter dürfen GLEICHZEITIG im Urlaub sein.
-- max_on_vacation = 99 → praktisch unbegrenzt (keine Warnung), bis konfiguriert.
create table if not exists team_settings (
  team text primary key
    check (team in ('salon','marketing','kundenservice','lager')),
  max_on_vacation int not null default 99,
  updated_at timestamptz not null default now()
);

insert into team_settings (team, max_on_vacation) values
  ('salon', 99), ('marketing', 99), ('kundenservice', 99), ('lager', 99)
on conflict (team) do nothing;

alter table team_settings enable row level security;
create policy "Authenticated read team_settings" on team_settings
  for select to authenticated using (true);
create policy "Authenticated write team_settings" on team_settings
  for all to authenticated using (true) with check (true);
