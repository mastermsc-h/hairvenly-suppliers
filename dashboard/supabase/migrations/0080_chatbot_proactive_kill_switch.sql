-- Kill-Switch für proaktive Bot-Generierung.
-- TRUE  = Webhook triggert Bot wie bisher (Auto/Assisted-Drafts)
-- FALSE = Webhook ignoriert Customer-Messages → keine LLM-Calls → keine Kosten.
--         Mitarbeiter müssen manuell "Antwort generieren" klicken.
-- Wieder einschalten: UPDATE chatbot_settings SET proactive_generation_enabled = true;
ALTER TABLE chatbot_settings
  ADD COLUMN IF NOT EXISTS proactive_generation_enabled BOOLEAN NOT NULL DEFAULT true;

-- User-Anweisung 2026-05-24: erstmal aus bis Kosten unter Kontrolle.
UPDATE chatbot_settings SET proactive_generation_enabled = false, updated_at = NOW() WHERE id = 1;
