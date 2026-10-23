-- Volltextsuche über ALLE Kontoumsätze (alle Konten, alle Zeiträume) für die Reiter
-- Zahlungseingänge und Kontoumsätze.
--   - Jeder Suchbegriff muss vorkommen (UND), Groß-/Kleinschreibung egal, in Gegenpartei,
--     Verwendungszweck, Buchungstext, Gegen-IBAN oder eigener IBAN.
--   - Zahl-Begriffe ("449,90", "1.234,56", "1234.5", "25566") treffen zusätzlich den Betrag
--     (Vorzeichen egal) — so findet "25566" sowohl die Bestellnummer im Zweck als auch 25.566 €.
--   - Datum "19.10." / "19.10.26" / "19.10.2026" trifft den Buchungstag (ohne Jahr: jedes Jahr).
-- security invoker: RLS von bank_transactions gilt (nur Admins).
create or replace function bank_suche(q text, nur_eingaenge boolean default false, lim int default 200)
returns setof bank_transactions
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  toks text[];
  tok text;
  val numeric;
  muster text;
  dm text[];
  sql text := 'select * from bank_transactions t where true';
begin
  toks := regexp_split_to_array(btrim(coalesce(q, '')), '\s+');
  if btrim(coalesce(q, '')) = '' then
    return;
  end if;
  if nur_eingaenge then
    sql := sql || ' and t.amount > 0';
  end if;
  foreach tok in array toks loop
    continue when tok = '';
    -- Datum: TT.MM. oder TT.MM.JJ(JJ) — Punkt am Ende bzw. Jahr unterscheidet es von Beträgen
    dm := regexp_match(tok, '^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$');
    if dm is not null and dm[1]::int between 1 and 31 and dm[2]::int between 1 and 12 then
      sql := sql || format(' and extract(day from t.booking_date) = %s and extract(month from t.booking_date) = %s', dm[1]::int, dm[2]::int);
      if dm[3] is not null then
        sql := sql || format(' and extract(year from t.booking_date) = %s', case when length(dm[3]) = 2 then 2000 + dm[3]::int else dm[3]::int end);
      end if;
      continue;
    end if;
    val := null;
    if tok ~ '^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$' or tok ~ '^-?\d+(,\d{1,2})?$' then
      val := replace(replace(tok, '.', ''), ',', '.')::numeric;   -- 1.234,56 · 1234,56 · 1234
    elsif tok ~ '^-?\d+\.\d{1,2}$' then
      val := tok::numeric;                                        -- 1234.56
    end if;
    muster := '%' || replace(replace(replace(tok, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    sql := sql || format(
      ' and (concat_ws(%L, t.counterparty_name, t.purpose, t.posting_text, t.counterparty_iban, t.account_iban) ilike %L',
      ' ', muster
    );
    if val is not null then
      sql := sql || format(' or abs(abs(t.amount) - %s) < 0.005', abs(val));
    end if;
    sql := sql || ')';
  end loop;
  sql := sql || format(' order by t.booking_date desc, t.id limit %s', greatest(1, least(coalesce(lim, 200), 500)));
  return query execute sql;
end;
$$;

grant execute on function bank_suche(text, boolean, int) to authenticated;
