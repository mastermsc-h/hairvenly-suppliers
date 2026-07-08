-- Tracking: welche Lieferscheine wurden wann von wem gedruckt.
-- Unabhängig von pack_sessions, da ein Lieferschein auch ohne aktive
-- Pack-Session gedruckt werden kann (Order-Status 'open').

create table if not exists printed_slips (
  id uuid primary key default gen_random_uuid(),
  order_name text not null,          -- "#22799" (matches Shopify order.name)
  printed_at timestamptz not null default now(),
  printed_by uuid references public.profiles(id)
);

create index if not exists printed_slips_order_name_idx on printed_slips(order_name);
create index if not exists printed_slips_printed_at_idx on printed_slips(printed_at desc);

-- Letzter Druck pro Order (mit Bearbeiter-Name)
create or replace view v_printed_slips_latest as
select distinct on (ps.order_name)
  ps.order_name,
  ps.printed_at,
  coalesce(p.display_name, p.username) as printed_by_name
from printed_slips ps
left join public.profiles p on p.id = ps.printed_by
order by ps.order_name, ps.printed_at desc;

-- RLS: nur Admin/Mitarbeiter (analog 0038)
alter table printed_slips enable row level security;

drop policy if exists "Admin read printed_slips" on printed_slips;
drop policy if exists "Admin write printed_slips" on printed_slips;
create policy "Admin read printed_slips" on printed_slips
  for select to authenticated using (public.is_admin());
create policy "Admin write printed_slips" on printed_slips
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
