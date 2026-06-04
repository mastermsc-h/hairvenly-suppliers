-- Kritische Zeiträume / Sperrzeiten: Zeitfenster, in denen möglichst kein
-- Urlaub genommen werden soll (z.B. Weihnachtsgeschäft Anf. Nov – Mitte Dez).
-- Wiederkehrend pro Jahr → als "MM-DD" gespeichert (Jahr egal).

create table vacation_blackouts (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  start_md text not null,                 -- "MM-DD"
  end_md text not null,                   -- "MM-DD" (kleiner als start_md = über Jahreswechsel)
  team text check (team is null or team in ('salon','marketing','kundenservice','lager')),
  note text,
  created_at timestamptz not null default now()
);

-- Beispiel-Sperrzeit (Weihnachtsgeschäft), team = NULL → gilt für alle Teams.
insert into vacation_blackouts (label, start_md, end_md, team)
values ('Weihnachtsgeschäft – Urlaub vermeiden', '11-01', '12-15', null);

alter table vacation_blackouts enable row level security;
create policy "Authenticated read vacation_blackouts" on vacation_blackouts
  for select to authenticated using (true);
create policy "Authenticated write vacation_blackouts" on vacation_blackouts
  for all to authenticated using (true) with check (true);
