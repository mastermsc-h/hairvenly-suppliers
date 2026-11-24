-- Aktionen für den Bot (Bug 24.11.2026: Kundin fragt „wann gibt es den Black Week
-- Rabatt?" → Bot erfand „bereits auf Instagram angekündigt" und nannte ein falsches
-- Profil). public_info = was der Bot Kundinnen über die Aktion sagen DARF. Nur
-- Aktionen mit public_info werden dem Bot gezeigt (laufend, in den nächsten 30 Tagen,
-- oder vor ≤ 14 Tagen beendet → „nicht mehr gültig").
alter table chatbot_campaigns add column if not exists public_info text;

insert into chatbot_campaigns (name, starts_on, ends_on, color, note, public_info)
select 'Black Friday', '2026-11-27', '2026-11-30', '#111827', 'Black Friday / Black Week',
       'Bis zu 30 % Rabatt auf Extensions und Tools (Zubehör).'
where not exists (select 1 from chatbot_campaigns where name = 'Black Friday' and starts_on = '2026-11-27');
