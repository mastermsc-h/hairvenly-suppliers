-- Mehrere Fotos pro Typ erlauben (z.B. bei großen Bestellungen mehrere Fotos
-- der Produkte neben der Rechnung). Pflicht bleibt: mind. 1 pro Typ.
alter table pack_photos drop constraint if exists pack_photos_session_id_photo_type_key;
