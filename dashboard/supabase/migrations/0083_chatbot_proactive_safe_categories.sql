-- Granular Kill-Switch: erweitert 0080.
--
-- Bisheriges Verhalten:
--   proactive_generation_enabled = TRUE  → Bot generiert wie immer
--   proactive_generation_enabled = FALSE → Bot generiert NIE proaktiv
--
-- Neues Verhalten:
--   proactive_generation_enabled = TRUE  → Bot generiert wie immer (unverändert)
--   proactive_generation_enabled = FALSE → Bot generiert nur für Sessions, deren
--     Category in proactive_safe_categories enthalten ist. Risky Categories
--     (color_advice, gewerbe, appointment, complaint, partnership) bleiben
--     Mitarbeiter-Click only.
--
-- User-Anweisung 2026-05-26: "Granularer Kill-Switch — Bot antwortet automatisch
-- nur bei availability, general, pricing. Bei color_advice, gewerbe, appointment,
-- complaint, partnership weiter MA-Click nötig. Best of both."
--
-- Warum NICHT order_status auf der Whitelist? Bot hat KEIN Order-Lookup-Tool
-- (keine Shopify-Order-API angebunden). Eine Auto-Antwort wäre nur eine
-- statische "schau in deine Versand-Mail / Kollegin meldet sich"-Phrase →
-- wirkt dumm. Solange kein get_order_status-Tool existiert, bleibt
-- order_status Mitarbeiter-only. "Versandkosten" und "wie lange dauert
-- Versand" fallen unter pricing bzw. general und sind abgedeckt.

ALTER TABLE chatbot_settings
  ADD COLUMN IF NOT EXISTS proactive_safe_categories TEXT[]
    NOT NULL
    DEFAULT ARRAY['availability', 'general', 'pricing']::TEXT[];

-- Sicher idempotent: setzt nur bei NULL/leerem Array.
UPDATE chatbot_settings
SET proactive_safe_categories = ARRAY['availability', 'general', 'pricing']::TEXT[],
    updated_at = NOW()
WHERE id = 1
  AND (proactive_safe_categories IS NULL OR cardinality(proactive_safe_categories) = 0);
