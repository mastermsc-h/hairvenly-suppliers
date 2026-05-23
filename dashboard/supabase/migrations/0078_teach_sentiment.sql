-- Positive vs Correction-Feedback für Bot-Antworten unterscheiden.
-- teach_feedback_at existiert schon, sagt aber nur "Feedback gegeben".
-- teach_sentiment sagt WELCHER Art:
--   - 'positive'   = Mitarbeiter:in hat die Antwort als gut markiert (👍 Vorbild)
--   - 'correction' = Mitarbeiter:in hat sie nachtrainiert (besser-Version + Notiz)
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS teach_sentiment text
  CHECK (teach_sentiment IS NULL OR teach_sentiment IN ('positive', 'correction'));

COMMENT ON COLUMN chat_messages.teach_sentiment IS
  'Art des Mitarbeiter-Feedbacks auf eine Bot-Antwort: positive=Vorbild, correction=Nachtraining';
