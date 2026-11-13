import Link from "next/link";
import { Sparkles, AlertTriangle, ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ladeCodeBestellungen, ladeTagesUmsatzMap, codeStatistik, freieCodes, postingEffekte, normCode, verschiebe,
  FENSTER_TAGE, type Influencer, type Posting,
} from "@/lib/influencer";
import { heuteBerlin } from "@/lib/marketing-extern";
import { InfluencerFormular, PostingFormular, LoeschKnopf, PostingChart } from "./aktionen-client";

export const dynamic = "force-dynamic";

const CARD = "bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm";
const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const num = (n: number) => new Intl.NumberFormat("de-DE").format(n);
const pct = (n: number) => `${n > 0 ? "+" : ""}${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(n * 100)} %`;
const datum = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("de-DE") : "—");
const ART: Record<string, string> = { reel: "Reel", story: "Story", post: "Post", video: "Video", live: "Live", sonstiges: "Sonstiges" };

// Wie weit zurück Shopify-Codes und Tagesumsatz geladen werden
const TAGE_CODES = 180;
const TAGE_CHART = 90;

export default async function AktionenPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const sb = await createClient();
  const heute = heuteBerlin();

  const [{ data: inflRoh, error: e1 }, { data: postRoh, error: e2 }, codes, umsatz] = await Promise.all([
    sb.from("influencer").select("*").order("aktiv_von", { ascending: false, nullsFirst: false }),
    sb.from("influencer_postings").select("*").gte("datum", verschiebe(heute, -TAGE_CODES)).order("datum", { ascending: false }),
    ladeCodeBestellungen(TAGE_CODES).then((d) => ({ ok: true as const, d })).catch((e: unknown) => ({ ok: false as const, fehler: e instanceof Error ? e.message : String(e) })),
    ladeTagesUmsatzMap(TAGE_CODES).then((d) => ({ ok: true as const, d })).catch((e: unknown) => ({ ok: false as const, fehler: e instanceof Error ? e.message : String(e) })),
  ]);
  if (e1 || e2) {
    return <div className="p-4 md:p-8"><div className={`${CARD} text-sm text-rose-700`}>Influencer-Daten konnten nicht geladen werden: {(e1 ?? e2)?.message}</div></div>;
  }
  const influencer = (inflRoh ?? []) as Influencer[];
  const postings = (postRoh ?? []) as Posting[];
  const bestellungen = codes.ok ? codes.d : [];
  const tagesUmsatz = umsatz.ok ? umsatz.d : new Map<string, number>();

  const istAktiv = (i: Influencer) => (!i.aktiv_von || i.aktiv_von <= heute) && (!i.aktiv_bis || i.aktiv_bis >= heute);
  const aktive = influencer.filter(istAktiv);
  const inaktive = influencer.filter((i) => !istAktiv(i));
  const vergeben = new Set(influencer.filter((i) => i.rabattcode).map((i) => normCode(i.rabattcode!)));
  const vorschlaege = freieCodes(bestellungen, vergeben, verschiebe(heute, -60)).slice(0, 15);
  const effekte = postingEffekte(postings, influencer, tagesUmsatz, bestellungen, heute);
  const letztesPosting = new Map<string, string>();
  for (const p of postings) if (!letztesPosting.has(p.influencer_id)) letztesPosting.set(p.influencer_id, p.datum);

  const chartTage = [...tagesUmsatz].filter(([d]) => d >= verschiebe(heute, -TAGE_CHART)).sort(([a], [b]) => a.localeCompare(b)).map(([d, u]) => ({ datum: d, umsatz: u }));
  const chartPunkte = postings.filter((p) => p.datum >= verschiebe(heute, -TAGE_CHART)).map((p) => ({ datum: p.datum, name: influencer.find((i) => i.id === p.influencer_id)?.name ?? "?", art: ART[p.art] ?? p.art }));

  const zeile = (i: Influencer) => {
    const s = i.rabattcode ? codeStatistik(bestellungen, i.rabattcode, heute, i.aktiv_von, i.aktiv_bis) : null;
    const roi = s && i.kosten_eur ? s.umsatz / i.kosten_eur : null;
    return (
      <tr key={i.id} className="align-top">
        <td className="py-2 pr-3">
          <div className="font-medium text-neutral-900">{i.name}</div>
          <div className="text-xs text-neutral-500">{[i.handle, i.plattform !== "instagram" ? i.plattform : null].filter(Boolean).join(" · ")}</div>
          {i.verguetung && <div className="text-xs text-neutral-500">{i.verguetung}</div>}
        </td>
        <td className="py-2 pr-3 font-mono text-xs">{i.rabattcode ?? <span className="text-neutral-400">—</span>}</td>
        <td className="py-2 pr-3 text-xs text-neutral-600 whitespace-nowrap">{datum(i.aktiv_von)} – {i.aktiv_bis ? datum(i.aktiv_bis) : "läuft"}</td>
        <td className="py-2 pr-3 text-right tabular-nums">{s ? num(s.bestellungen) : "—"}<div className="text-xs text-neutral-500">{s ? `${s.letzte7} in 7 T · ${s.letzte30} in 30 T` : ""}</div></td>
        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{s ? eur(s.umsatz) : "—"}</td>
        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{i.kosten_eur != null ? eur(i.kosten_eur) : "—"}<div className="text-xs text-neutral-500">{roi != null ? `${roi.toFixed(1)}× Umsatz` : ""}</div></td>
        <td className="py-2 pr-3 text-xs text-neutral-600 whitespace-nowrap">{datum(letztesPosting.get(i.id) ?? null)}</td>
        <td className="py-2 text-right whitespace-nowrap">
          <InfluencerFormular vorlage={i} knopfText="" />
          <LoeschKnopf art="influencer" id={i.id} frage={`${i.name} mit allen Postings löschen?`} />
        </td>
      </tr>
    );
  };

  const tabelle = (liste: Influencer[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500">
            <th className="pb-2 font-medium">Influencer</th><th className="pb-2 font-medium">Code</th><th className="pb-2 font-medium">Zeitraum</th>
            <th className="pb-2 font-medium text-right">Code-Bestell.</th><th className="pb-2 font-medium text-right">Code-Umsatz</th>
            <th className="pb-2 font-medium text-right">Kosten</th><th className="pb-2 font-medium">Letztes Posting</th><th />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">{liste.map(zeile)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Sparkles size={22} /> Aktuelle Aktionen</h1>
          <p className="text-sm text-neutral-500">Influencer und Postings tragt ihr ein. Code-Nutzung und Umsatz kommen automatisch aus Shopify.</p>
        </div>
        <Link href="/marketing" className="text-sm underline text-neutral-600">← Marketing-Zahlen</Link>
      </div>

      {(!codes.ok || !umsatz.ok) && (
        <div className={`${CARD} flex gap-2 text-sm text-amber-800`}>
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{!codes.ok && `Shopify-Codes nicht geladen (${codes.fehler}). `}{!umsatz.ok && `Tagesumsatz nicht geladen (${umsatz.fehler}).`}</span>
        </div>
      )}

      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold">Aktive Influencer <span className="text-neutral-400 font-normal">· {aktive.length}</span></h2>
          <InfluencerFormular key={sp.code ?? "neu"} vorlage={sp.code ? { rabattcode: sp.code.toUpperCase(), aktiv_von: codeStatistik(bestellungen, sp.code, heute).ersteNutzung ?? heute } : undefined} offen={!!sp.code} />
        </div>
        {aktive.length ? tabelle(aktive) : <p className="text-sm text-neutral-500">Noch keine aktiven Influencer. Lege einen an, oder nimm unten einen benutzten Code.</p>}
        <p className="mt-3 text-xs text-neutral-400">Code-Bestellungen zählen nur im eingetragenen Zeitraum, höchstens {TAGE_CODES} Tage zurück. Stornierte Bestellungen zählen nicht.</p>
      </section>

      <section className={CARD}>
        <h2 className="font-semibold mb-1">Postings und Umsatz</h2>
        <p className="text-xs text-neutral-500 mb-3">Tagesumsatz der letzten {TAGE_CHART} Tage, rote Rauten = Posting-Tage.</p>
        {chartTage.length ? <PostingChart tage={chartTage} punkte={chartPunkte} /> : <p className="text-sm text-neutral-500">Kein Tagesumsatz verfügbar.</p>}
        <div className="mt-5 border-t border-neutral-100 pt-4">
          <h3 className="text-sm font-semibold mb-2">Posting eintragen</h3>
          <PostingFormular influencer={influencer.map((i) => ({ id: i.id, name: i.name }))} />
        </div>
      </section>

      <section className={CARD}>
        <h2 className="font-semibold mb-1">Wirkung je Posting</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Posting-Tag + {FENSTER_TAGE - 1} Folgetage gegen dieselben Wochentage der 4 Wochen davor. Das ist eine <b>Schätzung</b>: Sales, andere Aktionen oder Feiertage im selben Zeitraum verfälschen sie.
          Die Code-Bestellungen sind dagegen eine harte Zahl.
        </p>
        {effekte.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500">
                  <th className="pb-2 font-medium">Datum</th><th className="pb-2 font-medium">Influencer</th><th className="pb-2 font-medium">Art</th>
                  <th className="pb-2 font-medium text-right">Umsatz {FENSTER_TAGE} T</th><th className="pb-2 font-medium text-right">üblich</th>
                  <th className="pb-2 font-medium text-right">Abweichung</th><th className="pb-2 font-medium text-right">Code-Bestell.</th><th />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {effekte.map((e) => (
                  <tr key={e.posting.id}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{datum(e.posting.datum)}</td>
                    <td className="py-1.5 pr-3">{e.influencer?.name ?? "?"}{e.posting.link && <a href={e.posting.link} target="_blank" rel="noreferrer" className="ml-1 inline-block text-neutral-400 hover:text-neutral-700"><ExternalLink size={12} /></a>}</td>
                    <td className="py-1.5 pr-3 text-neutral-600">{ART[e.posting.art] ?? e.posting.art}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{e.tageImFenster ? eur(e.fenster) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-500">{e.tageImFenster ? eur(e.basis) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
                      {e.uplift === null ? <span className="text-neutral-400">{e.tageImFenster ? "zu wenig Daten" : "noch offen"}</span> : (
                        <span className={e.uplift > 0.05 ? "text-emerald-600" : e.uplift < -0.05 ? "text-rose-600" : "text-neutral-600"}>{pct(e.uplift)}</span>
                      )}
                      {e.ueberlagert && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800" title="Anderes Posting im ±2-Tage-Fenster, Effekte nicht trennbar">überlagert</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{e.influencer?.rabattcode ? `${e.codeBestellungen} · ${eur(e.codeUmsatz)}` : "—"}</td>
                    <td className="py-1.5 text-right"><LoeschKnopf art="posting" id={e.posting.id} frage="Posting löschen?" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Noch keine Postings eingetragen.</p>
        )}
      </section>

      <section className={CARD}>
        <h2 className="font-semibold mb-1">Benutzte Codes ohne Influencer</h2>
        <p className="text-xs text-neutral-500 mb-3">Rabattcodes aus Shopify der letzten 60 Tage, die noch keinem Influencer zugeordnet sind (allgemeine Shop-Codes wie WELCOME, EARLY, GEWERBE sind ausgeblendet). Klick legt den Influencer an.</p>
        {vorschlaege.length ? (
          <div className="flex flex-wrap gap-2">
            {vorschlaege.map((v) => (
              <Link key={v.code} href={`/marketing/aktionen?code=${encodeURIComponent(v.code)}`} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50" title="Als Influencer anlegen">
                <span className="font-mono">{v.code}</span> <span className="text-neutral-500">· {v.bestellungen}× · {eur(v.umsatz)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Keine.</p>
        )}
      </section>

      {inaktive.length > 0 && (
        <section className={CARD}>
          <h2 className="font-semibold mb-3">Beendete und geplante Kooperationen <span className="text-neutral-400 font-normal">· {inaktive.length}</span></h2>
          {tabelle(inaktive)}
        </section>
      )}
    </div>
  );
}
