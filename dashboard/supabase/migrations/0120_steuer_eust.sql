-- Einfuhrumsatzsteuer (EUSt) als eigene Steuerart im Steuer-Ledger.
-- Hintergrund: EUSt wird oft erst Monate nach dem eigentlichen Zeitraum gebucht;
-- der Finanzamt-Abgleich in /finances/overview weist darauf hin.

alter table steuer_posten drop constraint if exists steuer_posten_art_check;
alter table steuer_posten add constraint steuer_posten_art_check
  check (art in (
    'ust_va',
    'ust_nachzahlung',
    'eust',              -- Einfuhrumsatzsteuer
    'est_vz',
    'est_nachzahlung',
    'gewst_vz',
    'gewst_nachzahlung',
    'sonstige'
  ));
