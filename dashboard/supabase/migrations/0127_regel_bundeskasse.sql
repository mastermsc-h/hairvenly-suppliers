-- "Bundeskasse" war zu breit: darüber laufen auch DPMA-Gebühren (Markenamt), nicht nur Zoll.
-- Zoll/EUSt laufen bei Hairvenly über Carl Ungewitter, DHL Express und das Hauptzollamt.
delete from bank_kategorie_regeln where feld = 'counterparty_name' and muster = 'Bundeskasse';
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  (30, 'counterparty_name', 'DPMA', 'aus', 'aus_beitraege', 'Markenamt-Gebühren (über Bundeskasse)')
on conflict (feld, muster, richtung) do nothing;
