-- Insights aus den 3300 Instagram-Chats
-- Pro Chat: Hauptanliegen, Einwände, Team-Reaktion, Conversion-Blocker, Lost-Deal-Score, Mitarbeiter
create table if not exists chatbot_insights (
  id                    uuid primary key default gen_random_uuid(),
  source_chat_id        text unique not null,
  cluster               text,                    -- aus tagged_chats: primary_cluster
  main_request          text,                    -- "Preisanfrage 150g Tape russisch"
  objections            text[] default '{}',     -- ["zu teuer", "Lieferzeit"]
  team_response_quality text,                    -- 'excellent' | 'good' | 'ok' | 'bad' | 'missed'
  conversion            boolean,                 -- hat Kunde gekauft / wollte konkret kaufen
  conversion_blocker    text,                    -- "Preis", "Lager", "Unklare Antwort", null wenn konvertiert
  lost_deal_score       int check (lost_deal_score between 0 and 10), -- 0=irrelevant, 10=ganz klar verschenkter Verkauf
  team_member           text,                    -- Name wenn signiert
  good_phrases          text[] default '{}',     -- konkrete Verkaufs-stiftende Formulierungen aus dem Chat
  bad_phrases           text[] default '{}',     -- deflectierende Formulierungen
  summary               text,                    -- 1-Satz-Zusammenfassung
  created_at            timestamptz default now()
);

create index if not exists idx_insights_cluster      on chatbot_insights(cluster);
create index if not exists idx_insights_member       on chatbot_insights(team_member);
create index if not exists idx_insights_lost         on chatbot_insights(lost_deal_score desc);
create index if not exists idx_insights_conversion   on chatbot_insights(conversion);
create index if not exists idx_insights_objections   on chatbot_insights using gin(objections);

alter table chatbot_insights enable row level security;
create policy "insights_admin" on chatbot_insights for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);
