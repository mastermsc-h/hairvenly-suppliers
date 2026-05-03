-- Add supplier_line to chatbot_prices
-- 'amanda' = Russisch Glatt (60cm), 'ebru' = Usbekisch Wellig (45-85cm)

alter table chatbot_prices
  add column if not exists supplier_line text;

-- Update existing rows
update chatbot_prices set supplier_line = 'amanda'
  where length_cm = 60 or gram_label in ('100g','150g','225g');
update chatbot_prices set supplier_line = 'ebru'
  where supplier_line is null;
