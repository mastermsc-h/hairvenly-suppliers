-- Refinement-Historie: jeder Feedback-Loop wird angehängt
-- [{feedback, prev_text, new_text, at}, ...]
alter table chat_drafts
  add column if not exists refinement_history jsonb default '[]'::jsonb;
