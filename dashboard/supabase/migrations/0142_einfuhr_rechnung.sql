-- DHL-/Zoll-Rechnungsnummer(n) zur Bestellung (z.B. "ZIT8150777", mehrere mit Komma).
-- Taucht die Nummer im Verwendungszweck einer Abbuchung auf, gelten die Einfuhrabgaben
-- der Bestellung in der Liquiditätsvorschau als bezahlt.
alter table orders add column if not exists einfuhr_rechnung text
  check (einfuhr_rechnung is null or length(einfuhr_rechnung) <= 300);
