-- Notizen pro Bestellung in der Versand-Übersicht ("warum ist das noch nicht
-- raus?"). Bewusst pro BESTELLNUMMER, nicht pro pack_session: die meisten
-- offenen Bestellungen haben noch gar keine Session (nie gescannt).
-- Eine aktuelle Notiz je Bestellung, mit Autor + Zeit; leer speichern = löschen.
create table if not exists public.pack_order_notes (
  order_name text primary key,                  -- "#27732" (= Shopify order.name)
  note text not null check (char_length(note) between 1 and 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- RLS: nur Admin/Mitarbeiter (analog 0038/0039)
alter table public.pack_order_notes enable row level security;

drop policy if exists "Admin read pack_order_notes" on public.pack_order_notes;
drop policy if exists "Admin write pack_order_notes" on public.pack_order_notes;
create policy "Admin read pack_order_notes" on public.pack_order_notes
  for select to authenticated using (public.is_admin());
create policy "Admin write pack_order_notes" on public.pack_order_notes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
