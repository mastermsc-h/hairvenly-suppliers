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
-- nur bei availability, general, pricing, shipping. Bei color_advice, gewerbe,
-- appointment, complex weiter MA-Click nötig. Best of both."
--
-- Mapping shipping → order_status (existierende Category für Versand/Tracking).

ALTER TABLE chatbot_settings
  ADD COLUMN IF NOT EXISTS proactive_safe_categories TEXT[]
    NOT NULL
    DEFAULT ARRAY['availability', 'general', 'pricing', 'order_status']::TEXT[];

-- Sicher idempotent: setzt nur bei NULL/leerem Array.
UPDATE chatbot_settings
SET proactive_safe_categories = ARRAY['availability', 'general', 'pricing', 'order_status']::TEXT[],
    updated_at = NOW()
WHERE id = 1
  AND (proactive_safe_categories IS NULL OR cardinality(proactive_safe_categories) = 0);
