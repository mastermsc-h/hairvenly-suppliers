-- Neue Kategorie "models" — Modell-Anfragen (Casting / Vorher-Nachher-Modelle /
-- Foto-Modelle / "sucht ihr Modelle?"). User-Wunsch 2026-05-28.
--
-- CHECK-Constraint aus 0068 erweitern, sonst lehnt Postgres das manuelle
-- Setzen via setSessionCategory ab.
alter table chat_sessions drop constraint if exists chat_sessions_category_check;
alter table chat_sessions
  add constraint chat_sessions_category_check
  check (category is null or category in (
    'availability',
    'pricing',
    'color_advice',
    'appointment',
    'complaint',
    'order_status',
    'gewerbe',
    'partnership',
    'models',
    'general'
  ));
