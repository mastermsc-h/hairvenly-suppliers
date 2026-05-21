-- Neuer Bot-Modus "selective_auto": Bot antwortet selbständig wenn Confidence-Check
-- ergibt dass die Antwort sicher ist (klare Kategorie, konkrete Daten im Reply,
-- keine Unsicherheits-Phrasen). Sonst fällt er auf assisted-Modus zurück (Draft).
alter table chat_sessions drop constraint if exists chat_sessions_bot_mode_check;
alter table chat_sessions
  add constraint chat_sessions_bot_mode_check
  check (bot_mode = any (array['auto'::text, 'selective_auto'::text, 'assisted'::text, 'off'::text]));

-- Tracking: war diese Assistant-Message autonom gesendet (vom Bot ohne
-- Mitarbeiter-Approval) oder via assisted-Modus + Approve?
alter table chat_messages
  add column if not exists auto_sent boolean not null default false;
