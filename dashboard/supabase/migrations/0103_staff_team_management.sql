-- Neues Team "management" zusätzlich zu salon/marketing/kundenservice/lager.
-- Check-Constraints auf allen team-Spalten erweitern.

alter table staff_members drop constraint staff_members_team_check;
alter table staff_members add constraint staff_members_team_check
  check (team in ('salon','marketing','kundenservice','lager','management'));

alter table team_settings drop constraint team_settings_team_check;
alter table team_settings add constraint team_settings_team_check
  check (team in ('salon','marketing','kundenservice','lager','management'));

alter table vacation_blackouts drop constraint vacation_blackouts_team_check;
alter table vacation_blackouts add constraint vacation_blackouts_team_check
  check (team is null or team in ('salon','marketing','kundenservice','lager','management'));

insert into team_settings (team, max_on_vacation) values ('management', 99)
on conflict (team) do nothing;
