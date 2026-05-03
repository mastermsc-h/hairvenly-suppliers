-- Chatbot pricing table
-- Stores selling prices per method + length for the chatbot to calculate pack quantities
-- Source: Shopify product catalog

create table if not exists chatbot_prices (
  id          uuid primary key default gen_random_uuid(),
  method      text not null,        -- tape, mini_tape, bondings, tressen, genius_weft, invisible_tape, clip_in, ponytail
  length_cm   smallint,             -- e.g. 45, 55, 60, 65, 85 (null for gram-based like clip-in)
  gram_label  text,                 -- for clip-in/ponytail: "100g", "150g", "225g", "130g"
  gram_per_pack smallint not null,  -- grams per purchasable pack: tape=25, bondings=50, tressen=50, etc.
  price_eur   numeric(8,2) not null,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create unique index if not exists chatbot_prices_unique
  on chatbot_prices(method, coalesce(length_cm::text,''), coalesce(gram_label,''));

-- RLS
alter table chatbot_prices enable row level security;

create policy "Prices readable by authenticated"
  on chatbot_prices for select
  to authenticated
  using (true);

create policy "Prices writable by service role"
  on chatbot_prices for all
  to service_role
  using (true)
  with check (true);

-- Seed data from Shopify (as of 2026-05)
-- Pack sizes: Tape=25g, Mini Tape=50g, Bondings=50g, Tressen=50g, Genius Weft=50g, Invisible Tape=50g
-- Clip-in: sold in 100g / 150g / 225g fixed packs
-- Ponytail: 130g fixed

insert into chatbot_prices (method, length_cm, gram_label, gram_per_pack, price_eur) values
  -- Tape (25g/Pack)
  ('tape', 45,  null,   25,  44.75),
  ('tape', 55,  null,   25,  47.25),
  ('tape', 65,  null,   25,  49.75),
  ('tape', 85,  null,   25,  67.50),

  -- Bondings (50g/Pack)
  ('bondings', 65, null, 50, 49.75),
  ('bondings', 85, null, 50, 67.50),

  -- Tressen (50g/Pack)
  ('tressen', 65, null, 50, 99.50),

  -- Genius Weft (50g/Pack)
  ('genius_weft', 60, null, 50, 195.00),
  ('genius_weft', 65, null, 50, 109.99),

  -- Invisible Tape (50g/Pack)
  ('invisible_tape', 65, null, 50, 195.00),

  -- Clip-in (fest: 100g / 150g / 225g pro Pack, Länge: 60cm)
  ('clip_in', 60, '100g', 100, 159.00),
  ('clip_in', 60, '150g', 150, 225.00),
  ('clip_in', 60, '225g', 225, 225.00),

  -- Ponytail (130g/Pack)
  ('ponytail', 65, '130g', 130, 179.99)

on conflict do nothing;
