-- Pack-Tabellen: Zugriff von "alle authenticated" auf "nur Admin/Mitarbeiter"
-- einschränken. Lieferanten-Accounts (is_admin=false) konnten bisher via
-- Supabase-Client direkt pack_sessions/pack_scans/pack_photos/printed_labels
-- lesen und schreiben — die UI hat das geblockt, die DB nicht.
-- Nutzt die bestehende security-definer-Funktion public.is_admin().

-- ── pack_sessions ────────────────────────────────────────────────
drop policy if exists "Authenticated read pack_sessions" on pack_sessions;
drop policy if exists "Authenticated write pack_sessions" on pack_sessions;
create policy "Admin read pack_sessions" on pack_sessions
  for select to authenticated using (public.is_admin());
create policy "Admin write pack_sessions" on pack_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── pack_scans ───────────────────────────────────────────────────
drop policy if exists "Authenticated read pack_scans" on pack_scans;
drop policy if exists "Authenticated write pack_scans" on pack_scans;
create policy "Admin read pack_scans" on pack_scans
  for select to authenticated using (public.is_admin());
create policy "Admin write pack_scans" on pack_scans
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── pack_photos ──────────────────────────────────────────────────
drop policy if exists "Authenticated read pack_photos" on pack_photos;
drop policy if exists "Authenticated write pack_photos" on pack_photos;
create policy "Admin read pack_photos" on pack_photos
  for select to authenticated using (public.is_admin());
create policy "Admin write pack_photos" on pack_photos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── printed_labels ───────────────────────────────────────────────
drop policy if exists "Authenticated read printed_labels" on printed_labels;
drop policy if exists "Authenticated write printed_labels" on printed_labels;
create policy "Admin read printed_labels" on printed_labels
  for select to authenticated using (public.is_admin());
create policy "Admin write printed_labels" on printed_labels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── storage: pack-photos bucket ──────────────────────────────────
drop policy if exists "Authenticated read pack-photos bucket" on storage.objects;
drop policy if exists "Authenticated upload pack-photos" on storage.objects;
drop policy if exists "Authenticated update pack-photos" on storage.objects;
drop policy if exists "Authenticated delete pack-photos" on storage.objects;
create policy "Admin read pack-photos bucket" on storage.objects
  for select to authenticated
  using (bucket_id = 'pack-photos' and public.is_admin());
create policy "Admin upload pack-photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pack-photos' and public.is_admin());
create policy "Admin update pack-photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'pack-photos' and public.is_admin());
create policy "Admin delete pack-photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pack-photos' and public.is_admin());
