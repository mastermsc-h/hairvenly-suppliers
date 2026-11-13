import Link from "next/link";
import { Megaphone, AlertTriangle, ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { ladeHalo, ladeMarketing, dringendeAufgaben, type MktDaten, type HaloDaten } from "@/lib/marketing-extern";
import MarketingChart from "./marketing-chart";
import DringendListe from "./dringend-liste";

export const dynamic = "force-dynamic";

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const eur2 = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
const num = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n));
const pct = (n: number) => new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 }).format(n);
const pct2 = (n: number) => new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const datum = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("de-DE") : "—");
const CARD = "bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm";
const LABEL = "text-xs font-medium text-neutral-600 uppercase tracking-wide";

function Delta({ jetzt, vorher, umkehren = false }: { jetzt: number; vorher: number; umkehren?: boolean }) {
  if (!vorher) return null;
  const d = (jetzt - vorher) / vorher;
  const gut = umkehren ? d < 0 : d > 0;
  return (
    <span className={`text-xs font-medium ${Math.abs(d) < 0.005 ? "text-neutral-500" : gut ? "text-emerald-600" : "text-rose-600"}`}>
      {d > 0 ? "▲" : d < 0 ? "▼" : "•"} {pct(Math.abs(d))}
    </span>
  );
}

function Kpi({ label, wert, sub, delta }: { label: string; wert: string; sub?: string; delta?: React.ReactNode }) {
  return (
    <div className={CARD}>
      <div className={LABEL}>{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900">{wert}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
        {delta}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

const ZEITRAEUME = [7, 28, 90] as const;

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ tage?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tage = ZEITRAEUME.includes(Number(sp.tage) as (typeof ZEITRAEUME)[number]) ? Number(sp.tage) : 28;

  const [mkt, halo] = await Promise.allSettled([ladeMarketing(tage), ladeHalo()]);
  const m: MktDaten | null = mkt.status === "fulfilled" ? mkt.value : null;
  const h: HaloDaten | null = halo.status === "fulfilled" ? halo.value : null;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Megaphone size={22} /> Marketing</h1>
          <p className="text-sm text-neutral-500">
            Zahlen aus dem Marketing-Dashboard, Aufgaben aus HALO. Nur lesend.{" "}
            <a href="https://marketing.hairvenly.de" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5">marketing.hairvenly.de <ExternalLink size={11} /></a>
            {" · "}
            <a href="https://halo.hairvenly.de" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5">halo.hairvenly.de <ExternalLink size={11} /></a>
          </p>
        </div>
        <div className="flex rounded-lg border border-neutral-300 overflow-hidden text-sm">
          {ZEITRAEUME.map((z) => (
            <Link key={z} href={`/marketing?tage=${z}`} className={`px-3 py-1.5 ${z === tage ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"}`}>
              {z} Tage
            </Link>
          ))}
        </div>
      </div>

      {/* Dringende Team-Aufgaben */}
      <section className={CARD}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Dringende Marketing-Aufgaben</h2>
          <Link href="/marketing/aufgaben" className="text-sm underline text-neutral-600">Alle Aufgaben →</Link>
        </div>
        {h ? <DringendListe eintraege={dringendeAufgaben(h)} /> : <Fehler text={halo.status === "rejected" ? String(halo.reason) : ""} />}
      </section>

      {!m ? (
        <section className={CARD}><Fehler text={mkt.status === "rejected" ? String(mkt.reason) : ""} /></section>
      ) : (
        <MarketingZahlen m={m} />
      )}
    </div>
  );
}

function Fehler({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-rose-700">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>Daten konnten nicht geladen werden. {text}</span>
    </div>
  );
}

function MarketingZahlen({ m }: { m: MktDaten }) {
  const u = m.umsatz;
  const netto = u.brutto - u.erstattungen;
  const nettoVorher = u.vorher_brutto - u.vorher_erstattungen;
  const kosten = m.werbung.meta_kosten + m.werbung.google_kosten;
  const kostenVorher = m.werbung.meta_kosten_vorher + m.werbung.google_kosten_vorher;
  const f = m.besucher.funnel[0];
  const fVorher = m.besucher.funnel[1];
  const conv = f && f.sessions ? f.purchased / f.sessions : 0;
  const convVorher = fVorher && fVorher.sessions ? fVorher.purchased / fVorher.sessions : 0;
  const akt = m.aktualitaet;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Umsatz netto" wert={eur(netto)} delta={<Delta jetzt={netto} vorher={nettoVorher} />} sub={`brutto ${eur(u.brutto)} − Erstattungen ${eur(u.erstattungen)}`} />
        <Kpi label="Bestellungen" wert={num(u.bestellungen)} delta={<Delta jetzt={u.bestellungen} vorher={u.vorher_bestellungen} />} sub={`Ø ${eur(u.bestellungen ? u.brutto / u.bestellungen : 0)}`} />
        <Kpi label="Werbekosten" wert={eur(kosten)} delta={<Delta jetzt={kosten} vorher={kostenVorher} umkehren />} sub={`Meta ${eur(m.werbung.meta_kosten)} · Google ${eur(m.werbung.google_kosten)}`} />
        <Kpi label="Umsatz je 1 € Werbung" wert={kosten ? `${(netto / kosten).toFixed(0)} €` : "—"} sub="gesamter Netto-Umsatz ÷ Werbekosten" />
        <Kpi label="Besucher (Sessions)" wert={f ? num(f.sessions) : "—"} delta={f && fVorher ? <Delta jetzt={f.sessions} vorher={fVorher.sessions} /> : undefined} sub={f ? `${datum(f.period_start)} – ${datum(f.period_end)}` : undefined} />
        <Kpi label="Kaufquote" wert={f ? pct2(conv) : "—"} delta={fVorher ? <Delta jetzt={conv} vorher={convVorher} /> : undefined} sub={f ? `${num(f.cart)} Warenkorb · ${num(f.checkout)} Kasse · ${num(f.purchased)} Kauf` : undefined} />
        <Kpi label="Google-Klicks" wert={num(m.suche.klicks)} delta={<Delta jetzt={m.suche.klicks} vorher={m.suche.klicks_vorher} />} sub={`${num(m.suche.impressionen)} Impressionen · Ø Pos. ${m.suche.position ?? "—"}`} />
        <Kpi label="SEO offen" wert={num(Object.values(m.seo_offen.anzahl ?? {}).reduce((a, b) => a + b, 0))} sub={`${m.seo_offen.anzahl?.hoch ?? 0} hoch · ${m.seo_offen.anzahl?.mittel ?? 0} mittel · ${m.seo_offen.anzahl?.niedrig ?? 0} niedrig`} />
      </div>

      <section className={CARD}>
        <h2 className="font-semibold mb-1">Umsatz und Werbekosten je Tag</h2>
        <p className="text-xs text-neutral-500 mb-3">{datum(m.zeitraum.von)} – {datum(m.zeitraum.bis)} · Vergleich mit {datum(m.zeitraum.vorher_von)} – {datum(m.zeitraum.vorher_bis)}</p>
        <MarketingChart tage={m.tage} />
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className={CARD}>
          <h2 className="font-semibold mb-3">Top-Suchbegriffe (Google)</h2>
          <Tabelle
            kopf={["Begriff", "Klicks", "Impr.", "Pos."]}
            zeilen={m.suche.top_suchbegriffe.slice(0, 15).map((q) => [q.begriff, num(q.klicks), num(q.impressionen), String(q.position)])}
          />
        </section>
        <section className={CARD}>
          <h2 className="font-semibold mb-1">Schnelle SEO-Erfolge</h2>
          <p className="text-xs text-neutral-500 mb-3">Begriffe auf Platz 11–20 mit vielen Impressionen: ein kleiner Schub bringt sie auf Seite 1.</p>
          <Tabelle
            kopf={["Begriff", "Pos.", "Impr.", "Seite"]}
            zeilen={m.suche.schnelle_erfolge.map((q) => [q.query, String(Math.round(q.position * 10) / 10), num(q.impressions), kurzeUrl(q.page)])}
          />
        </section>
        <section className={CARD}>
          <h2 className="font-semibold mb-1">Woher die Käufer kommen</h2>
          <p className="text-xs text-neutral-500 mb-3">Erstkontakt laut Shopify, nach Umsatz</p>
          <Tabelle
            kopf={["Quelle", "Bestell.", "Umsatz"]}
            zeilen={m.quellen.slice(0, 10).map((q) => [q.quelle, num(q.bestellungen), eur(q.umsatz)])}
          />
        </section>
        <section className={CARD}>
          <h2 className="font-semibold mb-1">Besucher nach Kanal</h2>
          <p className="text-xs text-neutral-500 mb-3">{m.besucher.kanaele[0] ? `${datum(m.besucher.kanaele[0].period_start)} – ${datum(m.besucher.kanaele[0].period_end)}` : ""}</p>
          <Tabelle
            kopf={["Kanal", "Sessions", "Kasse", "Quote"]}
            zeilen={m.besucher.kanaele.map((k) => [k.source || "—", num(k.sessions), num(k.checkouts), k.sessions ? pct(k.checkouts / k.sessions) : "—"])}
          />
        </section>
        <section className={CARD}>
          <h2 className="font-semibold mb-3">Meta-Kampagnen</h2>
          <Tabelle
            kopf={["Kampagne", "Kosten", "Klicks", "Reichweite"]}
            zeilen={m.werbung.meta_kampagnen.map((k) => [k.kampagne, eur2(k.kosten), num(k.klicks), num(k.reichweite)])}
          />
          {m.werbung.google_kampagnen.length > 0 && (
            <>
              <h3 className="font-semibold mt-5 mb-2">Google-Kampagnen</h3>
              <Tabelle
                kopf={["Kampagne", "Kosten", "Klicks", "Conv."]}
                zeilen={m.werbung.google_kampagnen.map((k) => [k.kampagne, eur2(k.kosten), num(k.klicks), String(Math.round(k.conversions * 10) / 10)])}
              />
            </>
          )}
        </section>
        <section className={CARD}>
          <h2 className="font-semibold mb-3">Meistbesuchte Seiten</h2>
          <Tabelle
            kopf={["Seite", "Sessions", "zur Kasse"]}
            zeilen={m.besucher.top_seiten.slice(0, 12).map((p) => [p.path, num(p.sessions), num(p.checkout_sessions)])}
          />
        </section>
      </div>

      <section className={CARD}>
        <h2 className="font-semibold mb-3">Offene SEO-Punkte (wichtigste zuerst)</h2>
        <ul className="divide-y divide-neutral-100 text-sm">
          {m.seo_offen.punkte.slice(0, 12).map((p, i) => (
            <li key={i} className="py-2 flex gap-3">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium h-fit ${p.schwere === "hoch" ? "bg-rose-100 text-rose-700" : p.schwere === "mittel" ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>{p.schwere}</span>
              <div className="min-w-0">
                <div className="text-neutral-900">{p.problem}</div>
                <div className="text-neutral-500 text-xs">{p.massnahme}{p.url ? ` · ${kurzeUrl(p.url)}` : ""}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-neutral-400">
        Datenstand: Bestellungen {datum(akt.bestellungen)} · Meta {datum(akt.meta_ads)} · Google Ads {datum(akt.google_ads)} · Google-Suche {datum(akt.google_suche)} · Besucher {datum(akt.shop_funnel)} · SEO-Audit {datum(akt.seo_audit)}.
        Umsatz = Shopify-Bestellsummen (ohne stornierte) minus Erstattungen im Zeitraum; kann leicht von Shopify Analytics abweichen.
      </p>
    </>
  );
}

function kurzeUrl(u: string) {
  return u.replace(/^https?:\/\/(www\.)?hairvenly\.de/, "") || "/";
}

function Tabelle({ kopf, zeilen }: { kopf: string[]; zeilen: string[][] }) {
  if (!zeilen.length) return <p className="text-sm text-neutral-500">Keine Daten im Zeitraum.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500">
            {kopf.map((k, i) => <th key={k} className={`pb-2 font-medium ${i > 0 ? "text-right" : ""}`}>{k}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {zeilen.map((z, i) => (
            <tr key={i}>
              {z.map((c, j) => <td key={j} className={`py-1.5 ${j > 0 ? "text-right tabular-nums whitespace-nowrap pl-3" : "max-w-[18rem] truncate"}`} title={c}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

