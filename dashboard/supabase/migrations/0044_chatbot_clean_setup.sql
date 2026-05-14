-- Saubere Chatbot-Infrastruktur (Reset)
-- Alte Tabellen werden archiviert (nicht gelöscht, falls wir Daten brauchen)
-- Neue Tabellen für FAQ + Live-Sessions + Messages

-- ── 1. Alte Tabellen archivieren ─────────────────────────────────────────────
alter table if exists chatbot_knowledge    rename to chatbot_knowledge_archive_v1;
alter table if exists chatbot_knowledge_v2 rename to chatbot_knowledge_archive_v2;

-- ── 2. Neue saubere FAQ-Tabelle ──────────────────────────────────────────────
create table if not exists chatbot_faq (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,             -- z.B. 'haarqualitaeten' (stable identifier)
  topic       text not null,                    -- haarqualitaeten | methoden | laengen | ...
  question    text not null,                    -- Frage in Endform
  answer      text not null,                    -- Antwort in Hairvenly-Stil
  order_idx   int default 0,                    -- Reihenfolge in der UI
  active      boolean default true,
  notes       text,                             -- interne Admin-Notizen
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_faq_active on chatbot_faq(active);
create index if not exists idx_faq_topic  on chatbot_faq(topic);
create index if not exists idx_faq_fts    on chatbot_faq
  using gin(to_tsvector('german', question || ' ' || answer));

-- ── 3. Bot-Persona (System-Prompt + Beispiele) ───────────────────────────────
create table if not exists chatbot_persona (
  id              uuid primary key default gen_random_uuid(),
  name            text not null default 'Lara',     -- Bot-Name
  avatar_url      text,                              -- Bot-Avatar
  system_prompt   text not null,                     -- Hauptanweisung an Claude
  few_shot_examples jsonb default '[]',              -- Top-Chats als Stil-Beispiele
  active          boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── 4. Chat-Sessions (eine pro Kunde × Kanal) ────────────────────────────────
create table if not exists chat_sessions (
  id              uuid primary key default gen_random_uuid(),
  channel         text not null check (channel in ('web','instagram','whatsapp')),
  external_id     text,                              -- WA-Nummer / IG-User-ID
  customer_name   text,
  status          text not null default 'active' check (status in ('active','awaiting_human','closed','escalated')),
  assigned_to     uuid references profiles(id),     -- Mitarbeiter der übernommen hat
  last_message_at timestamptz default now(),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_sessions_status  on chat_sessions(status);
create index if not exists idx_sessions_channel on chat_sessions(channel);
create index if not exists idx_sessions_last    on chat_sessions(last_message_at desc);
create unique index if not exists idx_sessions_external on chat_sessions(channel, external_id)
  where external_id is not null;

-- ── 5. Chat-Messages ─────────────────────────────────────────────────────────
create table if not exists chat_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references chat_sessions(id) on delete cascade,
  role            text not null check (role in ('user','assistant','tool','system','human_agent')),
  content         text,
  tool_calls      jsonb,                             -- Wenn Bot Tools aufruft
  tool_results    jsonb,                             -- Ergebnisse von Tool-Calls
  attachments     jsonb default '[]',                -- Bilder etc.
  agent_id        uuid references profiles(id),     -- Falls ein Mensch geschrieben hat
  created_at      timestamptz default now()
);

create index if not exists idx_messages_session on chat_messages(session_id, created_at);

-- ── 6. RLS ───────────────────────────────────────────────────────────────────
alter table chatbot_faq      enable row level security;
alter table chatbot_persona  enable row level security;
alter table chat_sessions    enable row level security;
alter table chat_messages    enable row level security;

-- FAQ: alle Authenticated lesen, nur Admin schreiben
create policy "faq_read"  on chatbot_faq for select using (auth.role() = 'authenticated');
create policy "faq_admin" on chatbot_faq for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- Persona: nur Admin
create policy "persona_admin" on chatbot_persona for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- Sessions: Admin/Employee sehen alles
create policy "sessions_admin" on chat_sessions for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- Messages: gleiche Logik wie Sessions
create policy "messages_admin" on chat_messages for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- ── 7. Updated_at-Trigger ────────────────────────────────────────────────────
create or replace function set_updated_at_chatbot()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists faq_set_updated_at on chatbot_faq;
create trigger faq_set_updated_at before update on chatbot_faq
  for each row execute function set_updated_at_chatbot();

drop trigger if exists persona_set_updated_at on chatbot_persona;
create trigger persona_set_updated_at before update on chatbot_persona
  for each row execute function set_updated_at_chatbot();

drop trigger if exists sessions_set_updated_at on chat_sessions;
create trigger sessions_set_updated_at before update on chat_sessions
  for each row execute function set_updated_at_chatbot();
