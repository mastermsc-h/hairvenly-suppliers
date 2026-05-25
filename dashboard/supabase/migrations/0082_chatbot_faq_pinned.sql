-- FAQ-Pinning: pinned=true FAQs werden IMMER in den Bot-Prompt geladen,
-- unabhängig vom Topic-Filter. Löst die Bug-Klasse "wichtige FAQ erreicht
-- den Bot nicht weil Topic-String nicht im Code-Whitelist".
ALTER TABLE chatbot_faq ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS chatbot_faq_pinned_active_idx ON chatbot_faq (pinned, active) WHERE pinned = true AND active = true;
