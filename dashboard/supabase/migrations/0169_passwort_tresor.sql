-- Passwort-Tresor für Admins (/admin/passwoerter).
-- Zero-Knowledge: Der Browser leitet aus dem Master-Passwort (PBKDF2-SHA256, 600k Runden)
-- einen AES-GCM-256-Schlüssel ab und verschlüsselt jeden Eintrag, bevor er den Server erreicht.
-- In der DB liegen nur Salt, Prüfwert und Chiffretexte — weder Server noch DB kennen das Master-Passwort.
create table if not exists public.passwort_tresor_meta (
  id int primary key default 1 check (id = 1),
  salt text not null,            -- base64, 16 Bytes
  iterationen int not null default 600000,
  pruef_iv text not null,        -- base64
  pruef_chiffre text not null,   -- verschlüsselter fester Text → Master-Passwort prüfen
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);

create table if not exists public.passwort_tresor_eintraege (
  id uuid primary key default gen_random_uuid(),
  iv text not null,
  chiffre text not null,         -- verschlüsseltes JSON {titel, benutzer, passwort, url, notiz, kategorie}
  erstellt_von uuid,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);

alter table public.passwort_tresor_meta enable row level security;
alter table public.passwort_tresor_eintraege enable row level security;
-- Zugriff nur über den Server (service_role) nach Rollenprüfung role='admin'; keine Policies.
