-- Add role-based access control for employees
-- Roles: admin (full access), employee (configurable), supplier (own data only)

alter table public.profiles
  add column if not exists role text not null default 'supplier',
  add column if not exists denied_features text[] not null default '{}';

-- Migrate existing users: admins get role 'admin', others stay 'supplier'
update public.profiles set role = 'admin' where is_admin = true;
update public.profiles set role = 'supplier' where is_admin = false;

-- Add check constraint for valid roles
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'employee', 'supplier'));
