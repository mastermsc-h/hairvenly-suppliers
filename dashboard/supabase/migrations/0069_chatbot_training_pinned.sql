-- Pinned-Flag: angepinnte Trainings werden IMMER in den Bot-Prompt geladen,
-- unabhängig vom Limit. So fallen wichtige Korrekturen nie aus dem Sichtfeld.
alter table chatbot_training
  add column if not exists pinned boolean not null default false;

create index if not exists idx_training_pinned on chatbot_training(pinned) where pinned = true;
