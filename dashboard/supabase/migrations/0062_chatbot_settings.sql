-- Globale Chatbot-Einstellungen (Singleton-Tabelle, ID = 1)
-- Steuert u.a. den Default-Bot-Modus für NEU erstellte Sessions.
create table if not exists chatbot_settings (
  id                 int primary key default 1 check (id = 1),
  default_bot_mode   text not null default 'off'
                     check (default_bot_mode in ('auto', 'assisted', 'off')),
  updated_at         timestamptz default now()
);

-- Default-Zeile anlegen falls leer
insert into chatbot_settings (id, default_bot_mode)
  values (1, 'off')
  on conflict (id) do nothing;

alter table chatbot_settings enable row level security;
create policy "settings_read_all" on chatbot_settings for select using (true);
create policy "settings_admin_write" on chatbot_settings for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- Default für neue Sessions ab jetzt 'off' (war 'auto' — daher kam das ungewollte Bot-Verhalten)
alter table chat_sessions
  alter column bot_mode set default 'off';
alter table chat_sessions
  alter column bot_auto_reply set default false;
