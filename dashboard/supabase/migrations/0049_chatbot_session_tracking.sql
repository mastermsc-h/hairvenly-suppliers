-- Tracking-Spalten für Inbox-UX
alter table chat_sessions
  add column if not exists last_customer_msg_at timestamptz,
  add column if not exists last_seen_by_agent_at timestamptz;

-- Initial-Befüllung last_customer_msg_at aus den existierenden Messages
update chat_sessions cs
set last_customer_msg_at = (
  select max(created_at) from chat_messages
  where session_id = cs.id and role = 'user'
)
where last_customer_msg_at is null;
