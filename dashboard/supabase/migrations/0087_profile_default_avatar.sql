-- Default-Avatar pro Profil (Mitarbeiter-Signatur für Bot-Antworten).
--
-- Wird genutzt wenn:
--   - die Mitarbeiterin eine Session übernimmt (takeoverSession)
--   - die Mitarbeiterin den Bot-Modus einer Session auf auto/assisted setzt
--   → in beiden Fällen wird session.bot_signature_name auf das Default
--     der Mitarbeiterin gesetzt (sofern gesetzt). Bot-Antworten in dieser
--     Session werden dann mit deren Avatar-Persönlichkeit signiert.
--
-- Nullable: wenn nicht gesetzt → fällt auf den bisherigen Mechanismus zurück
-- (random weighted pick aus chatbot_avatars).
--
-- User-Wunsch 2026-05-29: "ich möchte den eingeloggten Usern Standard-
-- Avatare zuweisen können bzw die sich auch — sodass wenn die assistiert
-- antworten oder den bot auf automodus setzen, deren Ava benutzt wird".

alter table profiles
  add column if not exists default_avatar_name text;

-- Index für Lookups (selten — pro takeover ein Read)
create index if not exists idx_profiles_default_avatar
  on profiles(default_avatar_name)
  where default_avatar_name is not null;

comment on column profiles.default_avatar_name is
  'Default-Bot-Signatur dieser Mitarbeiterin. Referenz auf chatbot_avatars.name (soft). Wird bei takeoverSession / setBotMode auf die Session übertragen.';
