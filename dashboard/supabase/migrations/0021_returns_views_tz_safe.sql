-- Fix timezone issues: output months as text "YYYY-MM-DD" instead of date
-- Date columns get serialized as timestamps by PostgREST and can shift across TZ boundaries.

drop view if exists v_returns_summary;

create view v_returns_summary as
select
  to_char(date_trunc('month', initiated_at), 'YYYY-MM-DD') as month,
  return_type,
  count(*)::int as total,
  count(*) filter (where status = 'resolved')::int as resolved,
  coalesce(sum(refund_amount), 0) as total_refund
from returns
where initiated_at is not null
group by 1, 2;
