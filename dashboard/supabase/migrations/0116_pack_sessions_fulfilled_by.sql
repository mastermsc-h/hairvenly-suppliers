-- "Versendet von": wer den Versand (completePackSession) tatsächlich ausgelöst hat.
-- Bisher wurde nur fulfilled_at gespeichert. packed_by ist der ERSTE Scanner und
-- wird bewusst nie überschrieben — wenn User 2 am iPhone versendet, war das
-- nirgends nachvollziehbar. FK auf profiles, damit PostgREST den Namen embedden
-- kann (profiles:fulfilled_by(display_name, username)) wie bei packed_by.
alter table public.pack_sessions
  add column if not exists fulfilled_by uuid references public.profiles(id) on delete set null;

comment on column public.pack_sessions.fulfilled_by is
  'Profil, das "Als versendet markieren" ausgelöst hat (kann von packed_by abweichen).';
