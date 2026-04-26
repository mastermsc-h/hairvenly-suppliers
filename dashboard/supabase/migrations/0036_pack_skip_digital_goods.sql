-- Skip-Reason "digital_goods" ergänzen (z.B. Schulungen — kein physischer Versand).

alter table pack_sessions drop constraint if exists pack_sessions_photos_skip_reason_check;

alter table pack_sessions
  add constraint pack_sessions_photos_skip_reason_check
  check (photos_skip_reason is null or photos_skip_reason in (
    'accessories',
    'care_products',
    'digital_goods',
    'auto_accessories',
    'auto_care_products',
    'auto_digital_goods',
    'auto_mixed_skip'
  ));
