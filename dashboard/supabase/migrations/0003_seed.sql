-- Seed initial suppliers. Adjust default_lead_weeks per supplier.
insert into public.suppliers (name, default_lead_weeks) values
  ('Amanda', 6),
  ('China',  8),
  ('Aria',   6)
on conflict (name) do nothing;

-- After creating an admin user via Supabase Auth (e.g. buchhaltung@hairvenly.de),
-- run this to mark them admin:
--   update public.profiles set is_admin = true where email = 'buchhaltung@hairvenly.de';
