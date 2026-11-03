-- Amanda-Anzahlung: statt des ganzen Betrags zuerst eine Anzahlung am `datum`, der Rest am `rest_datum`.
-- rest_basis_usd = offener Betrag beim Planen. Ist der offene Betrag später kleiner, ist die Anzahlung
-- bezahlt und nur noch der Rest geplant. Nur Planung, wie die übrigen Spalten.
alter table liquiditaet_verschiebung
  add column if not exists anzahlung_usd   numeric(14,2) check (anzahlung_usd is null or anzahlung_usd > 0),
  add column if not exists rest_datum      date,
  add column if not exists rest_basis_usd  numeric(14,2);
