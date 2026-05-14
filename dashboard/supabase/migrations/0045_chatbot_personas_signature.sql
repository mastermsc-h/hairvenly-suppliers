-- Bot ist "Ava" — repräsentiert wechselnde Mitarbeiterinnen per Signatur
-- z.B. "/Ava von Larissa", "/Ava von Barbara"

alter table chatbot_persona
  add column if not exists team_member_names text[] default array['Larissa','Barbara','Tanja','Ailar'];

-- Pro Session wird einmalig zufällig eine Signatur gewählt
alter table chat_sessions
  add column if not exists bot_signature_name text;
