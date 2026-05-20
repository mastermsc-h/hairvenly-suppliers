-- "gewerbe" fehlte im CHECK-Constraint aus 0060 → manuelles Setzen schlug fehl
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
    'general'
  ));
