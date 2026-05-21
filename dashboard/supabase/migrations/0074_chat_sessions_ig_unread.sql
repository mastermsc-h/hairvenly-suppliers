-- IG-Unread-Count: zeigt wieviele Nachrichten auf Instagram-Seite ungelesen
-- sind (= aus Sicht des Salons, die Kundin hat geschrieben aber wir haben in
-- der IG-App noch nicht geöffnet). Wird vom Sync-Job aus Graph-API geholt.
alter table chat_sessions
  add column if not exists ig_unread_count int not null default 0;

create index if not exists idx_sessions_ig_unread
  on chat_sessions(ig_unread_count) where ig_unread_count > 0;
