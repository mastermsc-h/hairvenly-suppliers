-- chatbot_settings.default_bot_mode muss auch selective_auto erlauben
alter table chatbot_settings drop constraint if exists chatbot_settings_default_bot_mode_check;
alter table chatbot_settings
  add constraint chatbot_settings_default_bot_mode_check
  check (default_bot_mode = any (array['auto'::text, 'selective_auto'::text, 'assisted'::text, 'off'::text]));
