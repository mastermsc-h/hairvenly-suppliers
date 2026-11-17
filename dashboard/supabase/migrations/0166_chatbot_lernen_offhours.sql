-- Lernschleife „Entwurf vs. echte Team-Antwort" + Abend-/Wochenend-Bot (Analyse 17.11.2026).
--
-- Befund: Das Team antwortet in der Instagram-App (1 von 1.341 Antworten kam aus dem
-- Dashboard). Entwürfe sah niemand, 9 von 995 wurden freigegeben. Ab jetzt:
--   • Sobald nach einem Entwurf eine Team-Antwort kommt, wird der Entwurf „superseded"
--     und mit der Team-Antwort verglichen (Haiku, nächtlicher Cron /api/cron/chatbot-lernen).
--   • Wissenslücken landen als Vorschlag in chatbot_learning_suggestions → /chatbot/lernen,
--     dort mit einem Klick als FAQ übernehmen oder verwerfen.
--   • Entwürfe ohne Team-Antwort nach 7 Tagen → „expired".

alter table chat_drafts drop constraint if exists chat_drafts_status_check;
alter table chat_drafts add constraint chat_drafts_status_check
  check (status in ('pending', 'approved', 'discarded', 'superseded', 'expired'));

alter table chat_drafts
  add column if not exists team_reply_text text,
  add column if not exists team_reply_at timestamptz,
  add column if not exists compared_at timestamptz,
  add column if not exists comparison jsonb,
  -- Entwurf, den der Abend-/Wochenend-Bot im Probelauf verschickt HÄTTE
  add column if not exists offhours_candidate boolean not null default false;

create index if not exists idx_chat_drafts_compare
  on chat_drafts(status, compared_at) where compared_at is null;

-- Abend-/Wochenend-Bot: off | shadow (nur markieren) | live (senden). Start: shadow.
alter table chatbot_settings
  add column if not exists offhours_autosend text not null default 'shadow';
alter table chatbot_settings drop constraint if exists chatbot_settings_offhours_autosend_check;
alter table chatbot_settings add constraint chatbot_settings_offhours_autosend_check
  check (offhours_autosend in ('off', 'shadow', 'live'));

create table if not exists chatbot_learning_suggestions (
  id                 uuid primary key default gen_random_uuid(),
  draft_id           uuid references chat_drafts(id) on delete cascade,
  session_id         uuid references chat_sessions(id) on delete cascade,
  category           text,
  kind               text not null check (kind in ('bot_wrong', 'bot_missing')),
  fact               text not null,      -- was das Team weiß (Kurzform)
  bot_said           text,               -- was der Bot stattdessen gesagt hat
  faq_question       text not null,
  faq_answer         text not null,
  team_reply_excerpt text,
  status             text not null default 'new' check (status in ('new', 'accepted', 'rejected')),
  faq_id             uuid references chatbot_faq(id) on delete set null,
  decided_by         uuid references profiles(id),
  decided_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_learning_status on chatbot_learning_suggestions(status, created_at desc);

alter table chatbot_learning_suggestions enable row level security;
drop policy if exists "learning_admin" on chatbot_learning_suggestions;
create policy "learning_admin" on chatbot_learning_suggestions for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);
