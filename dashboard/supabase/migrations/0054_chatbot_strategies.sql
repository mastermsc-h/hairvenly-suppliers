-- Verkaufs-Strategien: strukturierte Decision Trees für typische Beratungs-Szenarien
create table if not exists chatbot_strategies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                  -- z.B. "Welliges feines Haar, lang, schwarz"
  trigger     text not null,                  -- Wann gilt diese Strategie (Bot prüft den Chat-Kontext)
  steps       text not null,                  -- Geordnete Schritte mit Fallbacks (Markdown)
  active      boolean default true,
  priority    int default 50,                 -- 1-100, höher = wichtiger
  created_by  uuid references profiles(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_strategies_active on chatbot_strategies(active, priority desc);

alter table chatbot_strategies enable row level security;
create policy "strategies_admin" on chatbot_strategies for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

create or replace function update_strategies_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists strategies_updated_at on chatbot_strategies;
create trigger strategies_updated_at before update on chatbot_strategies
  for each row execute function update_strategies_updated_at();
