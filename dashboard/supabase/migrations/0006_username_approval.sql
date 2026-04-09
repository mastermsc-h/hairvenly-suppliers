-- Add username and approval fields to profiles
alter table public.profiles
  add column if not exists username text,
  add column if not exists approved boolean not null default false,
  add column if not exists display_name text;

-- Existing admin users are auto-approved
update public.profiles set approved = true where is_admin = true;

-- Username must be unique (but nullable for existing users)
create unique index if not exists profiles_username_uniq
  on public.profiles(lower(username)) where username is not null;

-- Update the auto-create profile trigger to include username from metadata
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, username, display_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'display_name'
  )
  on conflict (id) do update set
    username = coalesce(excluded.username, profiles.username),
    display_name = coalesce(excluded.display_name, profiles.display_name);
  return new;
end $$;

-- Helper to look up email by username (for login)
create or replace function public.email_for_username(uname text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from public.profiles where lower(username) = lower(uname) limit 1;
$$;
