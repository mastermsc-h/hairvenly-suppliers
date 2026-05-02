-- Chatbot Knowledge Base
-- Extracted Q&A pairs from real BIZ responses (Instagram chats)
-- Used as RAG data for the hairvenly.de chatbot

create table if not exists chatbot_knowledge (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null,        -- e.g. "farbberatung", "preise", "reklamation"
  cluster     text not null,        -- original cluster label e.g. "Farbberatung-Foto"
  question    text not null,        -- customer question (up to 400 chars)
  answer      text not null,        -- BIZ answer (60–1200 chars)
  biz_score   smallint not null default 3, -- 0–5 quality score
  conversion  boolean not null default false,
  methods     text[] default '{}',  -- e.g. ["tape","bonding"]
  colors      text[] default '{}',  -- e.g. ["pearl white","norvegian"]
  lengths     text[] default '{}',
  grams       text[] default '{}',
  source      text not null default 'instagram_export',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Full-text search index (German)
create index if not exists chatbot_knowledge_fts
  on chatbot_knowledge
  using gin(to_tsvector('german', coalesce(question,'') || ' ' || coalesce(answer,'')));

-- Topic filter index
create index if not exists chatbot_knowledge_topic_idx
  on chatbot_knowledge(topic);

-- Active filter
create index if not exists chatbot_knowledge_active_idx
  on chatbot_knowledge(active) where active = true;

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chatbot_knowledge_updated_at on chatbot_knowledge;
create trigger chatbot_knowledge_updated_at
  before update on chatbot_knowledge
  for each row execute function update_updated_at();

-- RLS: readable by authenticated users, writable by service role only
alter table chatbot_knowledge enable row level security;

create policy "Knowledge readable by authenticated"
  on chatbot_knowledge for select
  to authenticated
  using (active = true);

create policy "Knowledge writable by service role"
  on chatbot_knowledge for all
  to service_role
  using (true)
  with check (true);
