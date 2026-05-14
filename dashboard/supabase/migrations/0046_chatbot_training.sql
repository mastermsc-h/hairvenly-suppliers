-- Trainings-Beispiele: Korrekturen die der Bot in Zukunft befolgen soll
create table if not exists chatbot_training (
  id                uuid primary key default gen_random_uuid(),
  -- Letzte N Nachrichten vor der Korrektur ([{role,content},...])
  context_messages  jsonb not null default '[]',
  -- Letzte Kundenfrage (für quick reference)
  user_message      text not null,
  -- Was der Bot ursprünglich geantwortet hat (= schlechtes Beispiel)
  bad_answer        text,
  -- Wie er hätte antworten sollen (= gutes Beispiel)
  good_answer       text not null,
  -- Erklärung vom Admin (Hinweis für Bot)
  feedback          text,
  -- Optionale Tags für gezielte Suche (z.B. 'preise', 'farbberatung')
  tags              text[] default '{}',
  -- Aktiv = wird in System-Prompt mit eingebaut
  active            boolean default true,
  -- Wer hat trainiert
  created_by        uuid references profiles(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_training_active on chatbot_training(active);
create index if not exists idx_training_tags   on chatbot_training using gin(tags);

alter table chatbot_training enable row level security;
create policy "training_admin" on chatbot_training for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

create or replace function update_training_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists training_updated_at on chatbot_training;
create trigger training_updated_at before update on chatbot_training
  for each row execute function update_training_updated_at();
