alter table public.suppliers
  add column if not exists sort_order int not null default 100;

-- Default-Reihenfolge: Ebru (China) → Ebru (Türkei) → Amanda → Aria
update public.suppliers set sort_order = 1 where name = 'Ebru (China)';
update public.suppliers set sort_order = 2 where name = 'Ebru (Türkei)';
update public.suppliers set sort_order = 3 where name = 'Amanda';
update public.suppliers set sort_order = 4 where name = 'Aria';
