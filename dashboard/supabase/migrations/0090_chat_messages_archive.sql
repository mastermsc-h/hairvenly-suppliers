-- 2026-05-30: Archiv der IG-DM-Threads aus Account-Datenexport.
-- Quelle: Instagram Account → "Deine Informationen herunterladen" (JSON).
-- 3327 Threads, ~40k Messages. Wird einmalig befüllt, danach durchsuchbar
-- in /chatbot/chat-wissen (neue Source-Option "IG-Archiv").
--
-- BEWUSSTE Trennung von chat_messages: chat_messages enthält die "lebende"
-- Inbox seit Mai 2026 (Webhook-basiert), chat_messages_archive ist der
-- historische Bestand vor Dashboard-Onboarding. Unterschiedliche Schemas,
-- unterschiedliche RLS, kein Misch-Risiko.

create table if not exists chat_messages_archive (
  id            bigserial primary key,
  thread_id     text not null,            -- aus thread_path / participant
  thread_title  text,                     -- Customer-Anzeigename
  sender_name   text not null,
  is_hairvenly  boolean not null default false,
  content       text not null,            -- Plain-Text (UTF-8 fixed)
  timestamp_ms  bigint not null,
  message_at    timestamptz not null,
  imported_at   timestamptz not null default now()
);

create index if not exists idx_cma_thread     on chat_messages_archive(thread_id);
create index if not exists idx_cma_message_at on chat_messages_archive(message_at);
create index if not exists idx_cma_sender     on chat_messages_archive(is_hairvenly);

-- pg_trgm-Index für schnelle Substring-Suche (ilike '%foo%').
-- Wenn extension fehlt: Tabelle bleibt nutzbar, Suche nur langsamer.
create extension if not exists pg_trgm;
create index if not exists idx_cma_content_trgm on chat_messages_archive
  using gin (content gin_trgm_ops);

alter table chat_messages_archive enable row level security;

create policy "cma_read_authenticated" on chat_messages_archive
  for select using (auth.role() = 'authenticated');

create policy "cma_write_admin" on chat_messages_archive
  for all using (
    exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );

comment on table chat_messages_archive is
  'IG-DM-Archiv aus Meta-Account-Datenexport. Eingefroren, read-only für MAs.';
