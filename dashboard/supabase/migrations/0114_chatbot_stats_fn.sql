-- Aggregations-Funktion für die Chatbot-Statistik.
-- Bündelt pro Periode (Tag/Woche/Monat): eingehende Kundennachrichten (inbound),
-- Bot-Antworten, Mitarbeiter-Antworten, neue Konversationen und die Verteilung
-- nach Kategorie (als JSONB). Gibt genau EINE Zeile pro Periode zurück →
-- unabhängig vom Nachrichtenvolumen, keine Zeilen-Limits.
create or replace function chatbot_stats(p_granularity text, p_since date)
returns table (
  period       date,
  inbound      int,
  bot          int,
  human        int,
  new_sessions int,
  by_category  jsonb
)
language sql
stable
as $$
  with unit as (
    select case p_granularity
             when 'month' then 'month'
             when 'week'  then 'week'
             else 'day'
           end as u
  ),
  msg as (
    select date_trunc((select u from unit), m.created_at)::date as period,
           m.role,
           coalesce(s.category, 'general') as category
    from chat_messages m
    left join chat_sessions s on s.id = m.session_id
    where m.deleted_at is null
      and m.created_at >= p_since
      and m.role in ('user', 'human_agent', 'assistant')
  ),
  per_period as (
    select period,
           count(*) filter (where role = 'user')        as inbound,
           count(*) filter (where role = 'assistant')    as bot,
           count(*) filter (where role = 'human_agent')  as human
    from msg
    group by period
  ),
  cat_json as (
    select period, jsonb_object_agg(category, n) as by_category
    from (
      select period, category, count(*) as n
      from msg
      where role = 'user'
      group by period, category
    ) c
    group by period
  ),
  sess as (
    select date_trunc((select u from unit), created_at)::date as period,
           count(*) as new_sessions
    from chat_sessions
    where created_at >= p_since
    group by 1
  )
  select
    coalesce(p.period, s.period)                as period,
    coalesce(p.inbound, 0)::int                 as inbound,
    coalesce(p.bot, 0)::int                     as bot,
    coalesce(p.human, 0)::int                   as human,
    coalesce(s.new_sessions, 0)::int            as new_sessions,
    coalesce(cj.by_category, '{}'::jsonb)       as by_category
  from per_period p
  full join sess s on s.period = p.period
  left join cat_json cj on cj.period = coalesce(p.period, s.period)
  order by 1;
$$;

grant execute on function chatbot_stats(text, date) to authenticated, service_role;
