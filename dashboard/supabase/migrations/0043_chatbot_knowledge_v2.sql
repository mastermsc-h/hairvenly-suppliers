-- v2: LLM-destillierte Wissensdatenbank
-- Quelle: distilled_chats.jsonl (Claude Haiku 4.5 Output)
-- Format: saubere FAQ-Q&A mit strukturierten Fakten + Tags

create table if not exists chatbot_knowledge_v2 (
  id              uuid primary key default gen_random_uuid(),
  topic           text not null,
  question        text not null,
  answer          text not null,
  facts           text[] default '{}',
  tags            text[] default '{}',
  source_chat_id  text,
  biz_score       int,
  conversion      boolean default false,
  active          boolean default true,
  reviewed        boolean default false,
  edited_by       uuid references profiles(id),
  edited_at       timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_kb2_topic     on chatbot_knowledge_v2(topic);
create index if not exists idx_kb2_active    on chatbot_knowledge_v2(active);
create index if not exists idx_kb2_reviewed  on chatbot_knowledge_v2(reviewed);
create index if not exists idx_kb2_tags      on chatbot_knowledge_v2 using gin(tags);

-- Volltextsuche (deutsch) über question + answer
create index if not exists idx_kb2_fts on chatbot_knowledge_v2
  using gin (to_tsvector('german', question || ' ' || answer));

alter table chatbot_knowledge_v2 enable row level security;

create policy "kb2_read_authenticated" on chatbot_knowledge_v2
  for select using (auth.role() = 'authenticated');

create policy "kb2_write_admin" on chatbot_knowledge_v2
  for all using (
    exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );

create or replace function update_kb2_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists kb2_set_updated_at on chatbot_knowledge_v2;
create trigger kb2_set_updated_at before update on chatbot_knowledge_v2
  for each row execute function update_kb2_updated_at();

comment on table chatbot_knowledge_v2 is
  'LLM-destillierte FAQ-Wissensbasis aus echten Instagram-Chats. Quelle: Claude Haiku 4.5.';
comment on column chatbot_knowledge_v2.facts is
  'Strukturierte Fakten als Array — direkt als Bullet Points verwendbar';
comment on column chatbot_knowledge_v2.tags is
  'Suchbare Tags (z.B. tape, 60cm, russisch, blond) für RAG-Filter';
comment on column chatbot_knowledge_v2.reviewed is
  'true = vom Admin geprüft und freigegeben für Bot-Nutzung';
