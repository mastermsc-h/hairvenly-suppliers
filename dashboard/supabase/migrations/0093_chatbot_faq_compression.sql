-- 0093: FAQ-Kompression (Kosten-Optimierung)
--
-- PROBLEM: Die ~73 immer geladenen FAQs (pinned + core) machen ~16k Token in
-- JEDEM Sonnet-Prompt aus (größter Einzelblock, 36%). Antworten sind oft
-- verbose formuliert (Emojis, Füllwörter, doppelte Erklärungen).
--
-- LÖSUNG: Spalte answer_short — eine fakttreue Kurzfassung jeder Antwort.
-- Das ORIGINAL (answer) bleibt UNANGETASTET → voll reversibel. Der Bot nutzt
-- answer_short nur, wenn das Flag use_faq_compression=true ist UND answer_short
-- gefüllt ist; sonst weiter answer (Zero-Regression).

ALTER TABLE chatbot_faq
  ADD COLUMN IF NOT EXISTS answer_short TEXT;

-- Optional: Kurzfassung der Frage (meist nicht nötig — Fragen sind schon kurz).
ALTER TABLE chatbot_faq
  ADD COLUMN IF NOT EXISTS question_short TEXT;

-- Feature-Flag (global). Default false = bestehendes Verhalten bleibt.
ALTER TABLE chatbot_settings
  ADD COLUMN IF NOT EXISTS use_faq_compression BOOLEAN NOT NULL DEFAULT false;
