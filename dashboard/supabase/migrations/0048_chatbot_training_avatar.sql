-- Trainings-Korrekturen werden pro Avatar gespeichert
-- avatar_name = NULL → gilt für ALLE Avatare (global)
-- avatar_name = 'Larissa' → gilt nur wenn Bot als Larissa antwortet

alter table chatbot_training
  add column if not exists avatar_name text;

create index if not exists idx_training_avatar on chatbot_training(avatar_name);
