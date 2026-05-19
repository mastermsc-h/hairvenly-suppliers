-- Instagram-Style "gelesen"-Indikator:
-- Wir tracken jetzt zwei Zeitstempel pro Session:
--   • last_opened_by_agent_at — wird automatisch beim Öffnen der Session-Detail
--     gesetzt. Governt die Bold/Normal-Optik des Namens in der Inbox (Name fett
--     wenn die Kundin seither geschrieben hat).
--   • last_seen_by_agent_at — wird nur bei expliziten Aktionen gesetzt
--     (Antworten, "Als erledigt", "Als ungelesen"-Toggle). Governt den
--     "Nur unbeantwortet"-Filter.
--
-- So kann der Mitarbeiter eine Session anschauen ohne dass sie aus dem
-- Unread-Filter rausfällt, aber der visuelle Indikator schaltet trotzdem
-- auf "gelesen".
alter table chat_sessions
  add column if not exists last_opened_by_agent_at timestamptz;
