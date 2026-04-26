-- Foto-Pflicht überspringen für Bestellungen mit nur Zubehör/Pflegeprodukten
-- Entweder automatisch (alle Items aus skip-Collections) oder manuell vom Mitarbeiter.

alter table pack_sessions
  add column if not exists photos_skipped boolean not null default false,
  add column if not exists photos_skip_reason text,
  add column if not exists photos_skipped_at timestamptz,
  add column if not exists photos_skipped_by uuid references public.profiles(id);

-- Reason: nur erlaubte Werte
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pack_sessions_photos_skip_reason_check'
  ) then
    alter table pack_sessions
      add constraint pack_sessions_photos_skip_reason_check
      check (photos_skip_reason is null or photos_skip_reason in ('accessories', 'care_products', 'auto_accessories', 'auto_care_products', 'auto_mixed_skip'));
  end if;
end$$;
