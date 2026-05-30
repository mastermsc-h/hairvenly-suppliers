-- Manuell gesetzte Zusatz-Kategorien pro Chat-Session.
--
-- chat_sessions.category bleibt die PRIMARY-Kategorie (von Haiku
-- automatisch klassifiziert, bei jeder neuen Customer-Message ggf.
-- aktualisiert).
--
-- additional_categories ist eine MA-only-Liste: Sessions die thematisch
-- in mehrere Tabs gehören (z.B. Reklamation UND Termin) können von MA
-- manuell mit Zweit-/Dritt-Kategorien getaggt werden. Haiku darf das
-- NIE überschreiben (User-Anweisung 2026-05-30: "manuell zusatz bleibt
-- fest").
--
-- Wirkung (Phase 1): reines Tagging + Inbox-Tab-Filter.
-- Sessions erscheinen in jedem Tab dessen Kategorie in
-- COALESCE(category, '') ∪ additional_categories ist. KEINE Auswirkung
-- auf Auto-Bot/safe-categories — der Kill-Switch-Check schaut nur auf
-- primary.category (sicherheitskonservativ).

alter table chat_sessions
  add column if not exists additional_categories text[] not null default '{}'::text[];

-- GIN-Index für effizienten Array-Contain-Filter in der Inbox-Liste.
create index if not exists idx_chat_sessions_additional_categories
  on chat_sessions using gin (additional_categories);

comment on column chat_sessions.additional_categories is
  'Manuell gesetzte Zusatz-Kategorien (TEXT[]). Komplementär zur primary-Kategorie in category. MA-Hoheit — Auto-Classifier darf nicht überschreiben. Werte aus dem 10er-Kategorie-Set (availability, pricing, general, appointment, color_advice, complaint, order_status, gewerbe, partnership, models).';
