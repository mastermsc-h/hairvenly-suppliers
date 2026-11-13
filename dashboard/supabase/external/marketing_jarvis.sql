-- Läuft im Supabase-Projekt marketing-analytics (tkbmygfwthqhrxzkxmnf), NICHT in unserem.
-- Rein lesender Zugang für das Hairvenly-Dashboard + Jarvis.
-- Ändert keine bestehende Tabelle, View, Policy oder Edge Function. Rückbau: ganz unten.
--
-- Liefert NUR Kennzahlen (keine E-Mails, Kunden-IDs, Tokens, Settings).
-- Schutz: nur mit Schlüssel (hier liegt nur dessen SHA-256-Hash).

create table if not exists public.jarvis_access (
  name     text primary key,
  key_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.jarvis_access enable row level security;
revoke all on public.jarvis_access from anon, authenticated;

-- p_teil: 'umsatz' (Umsatz/Werbung/Tage/Quellen/Besucher/IG/SEO) oder 'suche' (Google Suche).
-- Zwei Teile, damit jeder Aufruf sicher unter dem anon-Statement-Timeout (3 s) bleibt; null = alles.
drop function if exists public.jarvis_marketing(text, int);
create or replace function public.jarvis_marketing(p_key text, p_days int default 28, p_teil text default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  ok boolean;
  d   int  := greatest(1, least(coalesce(p_days, 28), 365));
  bis date := (now() at time zone 'Europe/Berlin')::date;
  von date := bis - d + 1;
  vbis date := von - 1;
  vvon date := von - d;
  erg jsonb;
begin
  select exists (
    select 1 from public.jarvis_access
    where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
  ) into ok;
  if not ok then
    raise exception 'kein Zugriff' using errcode = '42501';
  end if;

  erg := jsonb_build_object('stand', now(),
    'zeitraum', jsonb_build_object('von', von, 'bis', bis, 'tage', d, 'vorher_von', vvon, 'vorher_bis', vbis));

  if coalesce(p_teil, 'umsatz') = 'umsatz' then
  erg := erg || jsonb_build_object(
    'stand', now(),
    'zeitraum', jsonb_build_object('von', von, 'bis', bis, 'tage', d, 'vorher_von', vvon, 'vorher_bis', vbis),

    -- Datenaktualität je Quelle
    'aktualitaet', jsonb_build_object(
      'bestellungen', (select max(created_at) from shopify_orders),
      'meta_ads', (select max(date) from meta_ads),
      'google_ads', (select max(date) from google_ads),
      'google_suche', (select max(date) from gsc_performance),
      'instagram', (select max(date) from instagram_account_daily),
      'seo_audit', (select max(run_at) from seo_audit),
      'shop_funnel', (select max(period_end) from shop_funnel)
    ),

    -- Umsatz (Bestellsummen aus Shopify, ohne stornierte) + Erstattungen
    'umsatz', (
      select jsonb_build_object(
        'bestellungen', count(*) filter (where o.created_at::date between von and bis),
        'brutto', coalesce(sum(o.total) filter (where o.created_at::date between von and bis), 0),
        'rabatte', coalesce(sum(o.discounts) filter (where o.created_at::date between von and bis), 0),
        'erstattungen', (select coalesce(sum(amount), 0) from shopify_refunds where created_at::date between von and bis),
        'vorher_bestellungen', count(*) filter (where o.created_at::date between vvon and vbis),
        'vorher_brutto', coalesce(sum(o.total) filter (where o.created_at::date between vvon and vbis), 0),
        'vorher_erstattungen', (select coalesce(sum(amount), 0) from shopify_refunds where created_at::date between vvon and vbis)
      )
      from shopify_orders o
      where o.created_at::date between vvon and bis
        and upper(coalesce(o.financial_status, '')) <> 'VOIDED'
    ),

    -- Werbeausgaben
    'werbung', jsonb_build_object(
      'meta_kosten', (select coalesce(sum(spend), 0) from meta_ads where date between von and bis),
      'meta_kosten_vorher', (select coalesce(sum(spend), 0) from meta_ads where date between vvon and vbis),
      'google_kosten', (select coalesce(sum(cost), 0) from google_ads where date between von and bis),
      'google_kosten_vorher', (select coalesce(sum(cost), 0) from google_ads where date between vvon and vbis),
      'meta_kampagnen', coalesce((
        select jsonb_agg(k order by (k->>'kosten')::numeric desc) from (
          select jsonb_build_object('kampagne', coalesce(campaign, '—'), 'kosten', sum(spend), 'klicks', sum(clicks),
                                    'impressionen', sum(impressions), 'reichweite', sum(reach)) k
          from meta_ads where date between von and bis group by campaign
          order by sum(spend) desc nulls last limit 12) x), '[]'::jsonb),
      'google_kampagnen', coalesce((
        select jsonb_agg(k order by (k->>'kosten')::numeric desc) from (
          select jsonb_build_object('kampagne', coalesce(campaign, '—'), 'kosten', sum(cost), 'klicks', sum(clicks),
                                    'impressionen', sum(impressions), 'conversions', sum(conversions), 'conv_wert', sum(conversion_value)) k
          from google_ads where date between von and bis group by campaign
          order by sum(cost) desc nulls last limit 12) x), '[]'::jsonb)
    ),

    -- Tagesverlauf: Umsatz + Werbekosten
    'tage', coalesce((
      select jsonb_agg(jsonb_build_object(
        'datum', g.day::date,
        'bestellungen', coalesce(o.n, 0),
        'umsatz', coalesce(o.s, 0),
        'meta_kosten', coalesce(m.s, 0),
        'google_kosten', coalesce(ga.s, 0),
        'such_klicks', coalesce(sc.s, 0)
      ) order by g.day)
      from generate_series(von, bis, interval '1 day') as g(day)
      left join (select created_at::date dd, count(*) n, sum(total) s from shopify_orders
                 where created_at::date between von and bis and upper(coalesce(financial_status,'')) <> 'VOIDED' group by 1) o on o.dd = g.day::date
      left join (select date dd, sum(spend) s from meta_ads where date between von and bis group by 1) m on m.dd = g.day::date
      left join (select date dd, sum(cost) s from google_ads where date between von and bis group by 1) ga on ga.dd = g.day::date
      left join (select date dd, sum(clicks) s from gsc_performance where date between von and bis group by 1) sc on sc.dd = g.day::date
    ), '[]'::jsonb),

    -- Woher kommen Käufer (Erstkontakt)
    'quellen', coalesce((
      select jsonb_agg(x order by (x->>'umsatz')::numeric desc) from (
        select jsonb_build_object('quelle', coalesce(nullif(first_source_label, ''), nullif(channel, ''), 'unbekannt'),
                                  'bestellungen', count(*), 'umsatz', sum(total)) x
        from shopify_orders
        where created_at::date between von and bis and upper(coalesce(financial_status,'')) <> 'VOIDED'
        group by coalesce(nullif(first_source_label, ''), nullif(channel, ''), 'unbekannt')
      ) q
    ), '[]'::jsonb),

    -- Besucherverhalten (Shopify-Analytics, letzte 2 Abrufe)
    'besucher', jsonb_build_object(
      'funnel', coalesce((select jsonb_agg(f order by f.period_end desc) from (select period_start, period_end, sessions, cart, checkout, purchased from shop_funnel order by period_end desc limit 2) f), '[]'::jsonb),
      'kanaele', coalesce((select jsonb_agg(c order by c.sessions desc) from (select source, sessions, checkouts, period_start, period_end from shop_channel_conv where period_end = (select max(period_end) from shop_channel_conv)) c), '[]'::jsonb),
      'top_seiten', coalesce((select jsonb_agg(p order by p.sessions desc) from (select path, sessions, checkout_sessions, period_start, period_end from seo_page_sessions where period_end = (select max(period_end) from seo_page_sessions) order by sessions desc limit 15) p), '[]'::jsonb)
    ),

    -- Instagram (Konto)
    'instagram', coalesce((
      select jsonb_build_object('reichweite', sum(reach), 'profilaufrufe', sum(profile_views),
                                'website_klicks', sum(website_clicks), 'follower', (array_agg(follower_count order by date desc))[1])
      from instagram_account_daily where date between von and bis having count(*) > 0
    ), 'null'::jsonb),

    -- SEO-Audit: offene Punkte (Zähler + wichtigste 25)
    'seo_offen', jsonb_build_object(
      'anzahl', (select jsonb_object_agg(severity, n) from (select severity, count(*) n from seo_audit where status <> 'erledigt' group by severity) c),
      'punkte', coalesce((
        select jsonb_agg(p) from (
          select jsonb_build_object('schwere', severity, 'kategorie', category, 'problem', issue,
                                    'massnahme', action, 'url', url) p
          from seo_audit where status <> 'erledigt'
          order by case severity when 'hoch' then 0 when 'mittel' then 1 else 2 end, run_at desc
          limit 25) x), '[]'::jsonb)
    )
  );
  end if;

  if coalesce(p_teil, 'suche') = 'suche' then
  erg := erg || jsonb_build_object(
    'suche', jsonb_build_object(
      'klicks', (select coalesce(sum(clicks), 0) from gsc_performance where date between von and bis),
      'impressionen', (select coalesce(sum(impressions), 0) from gsc_performance where date between von and bis),
      'klicks_vorher', (select coalesce(sum(clicks), 0) from gsc_performance where date between vvon and vbis),
      'impressionen_vorher', (select coalesce(sum(impressions), 0) from gsc_performance where date between vvon and vbis),
      'position', (select round(sum(position * impressions) / nullif(sum(impressions), 0), 1) from gsc_performance where date between von and bis),
      'top_suchbegriffe', coalesce((
        select jsonb_agg(q order by (q->>'klicks')::int desc) from (
          select jsonb_build_object('begriff', query, 'klicks', sum(clicks), 'impressionen', sum(impressions),
                                    'position', round(sum(position * impressions) / nullif(sum(impressions), 0), 1)) q
          from gsc_performance where date between von and bis and query is not null
          group by query order by sum(clicks) desc limit 20) x), '[]'::jsonb),
      'top_seiten', coalesce((
        select jsonb_agg(q order by (q->>'klicks')::int desc) from (
          select jsonb_build_object('seite', page, 'klicks', sum(clicks), 'impressionen', sum(impressions)) q
          from gsc_performance where date between von and bis
          group by page order by sum(clicks) desc limit 10) x), '[]'::jsonb),
      'schnelle_erfolge', coalesce((select jsonb_agg(to_jsonb(w)) from (select * from gsc_quick_wins limit 10) w), '[]'::jsonb),
      'aufsteiger', coalesce((select jsonb_agg(to_jsonb(m)) from (select * from gsc_movers order by improvement desc nulls last limit 10) m), '[]'::jsonb)
    )
  );
  end if;

  return erg;
end $$;

revoke all on function public.jarvis_marketing(text, int, text) from public;
grant execute on function public.jarvis_marketing(text, int, text) to anon, authenticated;

-- Rückbau:
-- drop function if exists public.jarvis_marketing(text, int, text);
-- drop table if exists public.jarvis_access;
