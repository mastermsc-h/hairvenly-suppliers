-- Zahlungsabgleich: Start-Datum. Eingänge, die VOR diesem Tag gebucht wurden
-- und zu keiner Bestellung passen, werden beim Erstimport (FinTS holt 90 Tage
-- rückwirkend) nicht zur Prüfung vorgelegt, sondern als "before_start"
-- ignoriert. Treffer, Betragsabweichungen und Doppelzahlungen aus der Zeit
-- davor erscheinen weiterhin.
alter table bank_sync_state
  add column if not exists matching_since date not null default date '2026-10-15';
