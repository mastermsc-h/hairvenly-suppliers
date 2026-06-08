-- saved_to_faq_at: Zeitpunkt, zu dem die MA diese Kundennachricht aus dem Chat
-- heraus als FAQ gespeichert hat. Dient nur der UI (📌-Icon wird farbig), damit
-- man nicht dieselbe Frage mehrfach in die FAQ speichert.
alter table public.chat_messages
  add column if not exists saved_to_faq_at timestamptz;
