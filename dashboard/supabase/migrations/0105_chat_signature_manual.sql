-- signature_manual: true, wenn eine Mitarbeiterin den Ava (bot_signature_name)
-- für eine Session BEWUSST gesetzt hat (setSessionAvatar). Dann signiert auch
-- der Autobot mit diesem Namen ("Ava von <Name>"). Default false → der Autobot
-- signiert "Ava von Hairvenly" (kein Fake-Personenname).
alter table public.chat_sessions
  add column if not exists signature_manual boolean not null default false;
