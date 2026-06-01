-- 0094: Tool-Zwang bei Fakten-Intents (Schicht 1 Anti-Halluzination)
--
-- Default TRUE (reine Verbesserung): bei einer erkannten Preis-/Verfügbarkeits-/
-- Längen-Frage wird der Bot über tool_choice gezwungen, erst das passende Tool
-- aufzurufen, bevor er antwortet. Behebt die Wurzel (Baseline 01.06: Fakten-
-- Tools nur in ~23% genutzt → Bot riet Preise/Verfügbarkeit).
--
-- Notausschalter: UPDATE chatbot_settings SET use_force_tools = false;

ALTER TABLE chatbot_settings
  ADD COLUMN IF NOT EXISTS use_force_tools BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN chatbot_settings.use_force_tools IS
  'Tool-Zwang bei Fakten-Intents (Preis/Verfügbarkeit/Länge). Default true. false = Bot entscheidet selbst über Tool-Nutzung (altes Verhalten).';
