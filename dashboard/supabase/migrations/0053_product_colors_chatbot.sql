-- Erweiterung product_colors für Chatbot-Nutzung
alter table product_colors
  add column if not exists shopify_url text,
  add column if not exists bot_active boolean default true;

create index if not exists idx_product_colors_bot_active on product_colors(bot_active);
