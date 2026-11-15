-- Instagram-Statistik je Tag (@hairvenly.de) für den Startbildschirm.
-- Instagram liefert neue/verlorene Follower und Reichweite für vergangene Tage, aber keinen
-- Follower-Stand von früher → der tägliche Cron speichert ihn ab jetzt; ältere Tage sind aus
-- dem heutigen Stand minus Netto-Zuwachs zurückgerechnet (rekonstruiert = true).
create table if not exists instagram_tag (
  tag             date primary key,         -- Kalendertag (deutsche Zeit)
  follower        int,                      -- Gesamtstand am Tagesende
  rekonstruiert   boolean not null default false,
  neu             int,                      -- neue Follower
  verloren        int,                      -- entfolgt / Konto gelöscht
  reichweite      int,                      -- erreichte Konten
  aufrufe         int,                      -- Aufrufe (Views)
  profilaufrufe   int,
  website_klicks  int,
  interaktionen   int,
  stand           timestamptz not null default now()
);
alter table instagram_tag enable row level security;
-- keine Policies: Lesen/Schreiben nur per service_role (Cron, Startbildschirm nach requireProfile)

-- Letzter Stand von Demografie und Online-Zeiten (eine Zeile)
create table if not exists instagram_stand (
  id          int primary key default 1 check (id = 1),
  demografie  jsonb not null default '{}'::jsonb,  -- { alter: {...}, geschlecht: {...}, land: {...}, stadt: {...} }
  online      jsonb not null default '{}'::jsonb,  -- Stunde → Follower online
  stand       timestamptz not null default now()
);
alter table instagram_stand enable row level security;
