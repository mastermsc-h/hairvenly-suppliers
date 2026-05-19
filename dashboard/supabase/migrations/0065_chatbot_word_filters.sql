-- Auto-Lern-Sanitizer: Wörter/Phrasen die der Mitarbeiter wiederholt aus Bot-Entwürfen
-- entfernt, werden hier gesammelt. Ab N Vorkommen → aktiv im Sanitizer.
create table if not exists chatbot_word_filters (
  id              uuid primary key default gen_random_uuid(),
  pattern         text not null unique,        -- das Wort/Phrase (lower-case, normalisiert)
  replacement     text default '',             -- womit wird's ersetzt (default: weglassen)
  occurrences    int  default 1,              -- wie oft wurde es schon entfernt
  auto_added     boolean default false,       -- true = automatisch aktiviert ab Schwelle
  active         boolean default false,       -- aktiv = wird vom Sanitizer angewendet
  source_examples jsonb,                       -- Sample-Sessions wo es entfernt wurde
  created_at     timestamptz default now(),
  last_seen_at   timestamptz default now(),
  notes          text                          -- Mitarbeiter-Kommentar (optional)
);

create index if not exists idx_word_filters_active on chatbot_word_filters(active) where active = true;

alter table chatbot_word_filters enable row level security;
create policy "word_filters_admin" on chatbot_word_filters for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- Initial: bekannte Verbote vorbefüllen damit der Bot direkt sauber bleibt
insert into chatbot_word_filters (pattern, replacement, occurrences, auto_added, active, notes) values
  ('grammatur', 'menge', 99, true, true, 'Manuell hinzugefügt — User-Wunsch'),
  ('Grammatur', 'Menge', 99, true, true, 'Manuell hinzugefügt — User-Wunsch')
on conflict (pattern) do nothing;
