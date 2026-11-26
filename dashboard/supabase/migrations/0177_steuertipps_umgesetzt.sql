-- Steuertipps (/finances/steuertipps): welche Tipps schon umgesetzt sind.
-- Ein Eintrag je abgehaktem Tipp (Schlüssel = Tipp-Titel); Löschen = wieder offen.
create table if not exists steuertipps_umgesetzt (
  tipp text primary key,
  umgesetzt_am timestamptz not null default now(),
  umgesetzt_von uuid references auth.users(id) on delete set null
);

alter table steuertipps_umgesetzt enable row level security;

drop policy if exists "Admin read steuertipps_umgesetzt" on steuertipps_umgesetzt;
create policy "Admin read steuertipps_umgesetzt" on steuertipps_umgesetzt for select to authenticated using (is_admin());
drop policy if exists "Admin write steuertipps_umgesetzt" on steuertipps_umgesetzt;
create policy "Admin write steuertipps_umgesetzt" on steuertipps_umgesetzt for all to authenticated
  using (is_admin()) with check (is_admin());
