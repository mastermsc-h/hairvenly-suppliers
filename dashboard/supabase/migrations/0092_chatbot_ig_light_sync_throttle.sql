-- Throttle-Timestamp für den IG-Light-Sync.
--
-- Hobby-Plan erlaubt keinen */10-Cron. Wir triggern den Light-Sync
-- stattdessen piggyback aus /api/chat/inbox-stats (Badge-Poll alle 20s),
-- aber server-seitig auf alle 10 Min gedrosselt über diesen Timestamp.
-- DB-basiert (nicht modul-lokal), damit mehrere Lambda-Instanzen sich
-- denselben Gate teilen und die Graph-API nicht hämmern.
alter table chatbot_settings
  add column if not exists ig_light_sync_at timestamptz;

comment on column chatbot_settings.ig_light_sync_at is
  'Letzter IG-Light-Sync-Lauf. Throttle-Gate für den piggyback-Trigger aus inbox-stats (alle 10 Min).';
