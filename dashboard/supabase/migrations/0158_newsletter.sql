-- Newsletter (Shopify-E-Mail-Marketing): Stand und Bewegungen je Tag.
-- Bestände (abonniert/ausstehend/abgemeldet) misst der tägliche Cron über Shopify-Kundensegmente;
-- für ältere Tage sind sie aus dem nächsten gemessenen Tag zurückgerechnet (rekonstruiert = true).
-- neu/abmeldungen/neu_ausstehend zählen Kundinnen nach ihrem letzten Einwilligungs-Datum
-- (consentUpdatedAt) – wer sich an- und später wieder abgemeldet hat, zählt nur als Abmeldung.
create table if not exists newsletter_tag (
  tag             date primary key,
  abonniert       int,
  ausstehend      int,      -- angemeldet, Bestätigungslink (Double-Opt-in) noch nicht geklickt
  abgemeldet      int,
  rekonstruiert   boolean not null default true,
  neu             int not null default 0,   -- bestätigte Anmeldungen an diesem Tag
  neu_ausstehend  int not null default 0,   -- Anmeldungen an diesem Tag, noch unbestätigt
  abmeldungen     int not null default 0,
  stand           timestamptz not null default now()
);
alter table newsletter_tag enable row level security;
-- keine Policies: nur service_role (Cron, Seiten nach requireAdmin/requireProfile)
