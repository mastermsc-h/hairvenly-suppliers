-- Wächter-System: kontinuierliche Chat-Überwachung mit Alerts
create table if not exists chatbot_guardian_alerts (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid references chat_sessions(id) on delete cascade,
  severity     text not null check (severity in ('critical','warning','info')),
  alert_type   text not null,            -- 'unhappy_customer', 'lost_deal_risk', etc
  team_member  text,
  description  text not null,            -- Was ist das Problem
  suggestion   text not null,            -- Was sollte gemacht werden
  status       text not null default 'new' check (status in ('new','acknowledged','resolved','dismissed')),
  resolved_by  uuid references profiles(id),
  resolved_at  timestamptz,
  created_at   timestamptz default now()
);

-- Dedup: gleicher Alert-Typ + Session = 1× pro Tag (via UTC-Datum aus created_at)
create unique index if not exists ux_guardian_dedup
  on chatbot_guardian_alerts(session_id, alert_type, ((created_at AT TIME ZONE 'UTC')::date))
  where session_id is not null;

create index if not exists idx_guardian_status   on chatbot_guardian_alerts(status);
create index if not exists idx_guardian_severity on chatbot_guardian_alerts(severity);
create index if not exists idx_guardian_session  on chatbot_guardian_alerts(session_id);
create index if not exists idx_guardian_created  on chatbot_guardian_alerts(created_at desc);

alter table chatbot_guardian_alerts enable row level security;
create policy "guardian_admin" on chatbot_guardian_alerts for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);
