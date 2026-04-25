-- scan_method: 'barcode' (regulärer Scan) | 'manual' (Mitarbeiter hat Item manuell bestätigt)
alter table pack_scans
  add column if not exists scan_method text not null default 'barcode';
