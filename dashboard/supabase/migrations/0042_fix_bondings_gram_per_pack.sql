-- Bondings sind 25g/Packung (nicht 50g)
update chatbot_prices
  set gram_per_pack = 25
  where method = 'bondings';
