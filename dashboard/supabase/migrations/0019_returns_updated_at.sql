-- Add updated_at tracking to returns

alter table returns add column if not exists updated_at timestamptz not null default now();

-- Trigger: auto-update updated_at on any UPDATE
create or replace function set_returns_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists returns_updated_at_trigger on returns;

create trigger returns_updated_at_trigger
  before update on returns
  for each row
  execute function set_returns_updated_at();

-- Initialize existing rows
update returns set updated_at = coalesce(resolved_at, created_at) where updated_at is null;
