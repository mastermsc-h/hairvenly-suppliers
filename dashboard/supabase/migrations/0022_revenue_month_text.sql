-- Store month as text "YYYY-MM-01" to avoid timezone shifts on read
alter table shopify_monthly_revenue
  alter column month type text using to_char(month, 'YYYY-MM-DD');
