-- Feature-Flag für den Slim-Prompt-Refactor.
--
-- Default false (zero-regression) — Admin schaltet bewusst ein.
-- Wenn true: respondAsBot verwendet einen drastisch gekürzten System-
-- Prompt (~10k statt ~50k Tokens). Bot wird gleichzeitig schlauer
-- (weniger Lärm im Kontext) UND billiger (weniger Input-Tokens).
--
-- User-Anweisung 2026-05-29: "Slim-Prompt-Refactor starten".

alter table chatbot_settings
  add column if not exists use_lean_prompt boolean not null default false;

comment on column chatbot_settings.use_lean_prompt is
  'Slim-Prompt-Modus für respondAsBot. Default false. Wenn true: kürzere Hard-Rules + keine Training-Beispiele + nur Top-2-Strategien. Ziel ~10k statt ~50k Tokens pro Call.';
