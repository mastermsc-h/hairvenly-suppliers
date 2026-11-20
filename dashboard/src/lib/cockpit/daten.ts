// Startbildschirm ("Cockpit") — Daten-Lader (server-only, service_role).
// Aufrufer prüfen vorher requireProfile() + hasFeature(); jede Funktion ist per cache()
// einmal pro Request (das Lagebild nutzt dieselben Zahlen wie die Einzel-Widgets).
import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { ladePrognose } from "@/lib/liquiditaet/daten";
import { plusTage, zahlGruppe } from "@/lib/liquiditaet/rechnung";
import { shopifyGraphQL } from "@/lib/shopify";
import { holeShopifyUmsatzMonat } from "@/lib/shopify-umsatz";
import { loadDeadStock } from "@/lib/stock-deadstock";
import { FAST_TOT_STANDARD_MONATE } from "@/lib/deadstock-grenze";
import { holeFollowerLive, type InstagramTag } from "@/lib/instagram-statistik";
import { ladeWerbeteil } from "@/lib/marketing-extern";
import { salonUmsatzJahr } from "@/lib/finanzen/salon-umsatz";
import { ladeGewerbeMarkiert } from "@/lib/gewerbe";
import type { FinanzMonatsdaten } from "@/lib/types";
import { compute, taxChain } from "@/lib/finanzen/steuerrechnung";
import type {
  Ampel, AuslandDaten, BesucherDaten, ChatDaten, CockpitLayout, Eintrag, EintragArt, HyDaten, KampagneDaten,
  GewerbeDaten, LiqGruppe, LiquiditaetDaten, PflichtenDaten, SteuerArt, SteuerKasseDaten, PflichtPosten, ShopifyDaten, Signal, TotesKapitalDaten, InstagramDaten, IgAnfragenDaten, IgAnfragenPeriode, WerbungDaten, UmsatzDaten,
} from "./typen";

const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
const heuteBerlin = () => berlin.format(new Date());
const r0 = (n: number) => Math.round(n);
const tageImMonat = (monat: string) => {
  const [y, m] = monat.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** UTC-Offset von Europe/Berlin an einem Datum, z.B. "+01:00". */
function berlinOffset(iso: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" })
    .formatToParts(new Date(`${iso}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = part.match(/GMT([+-])(\d{1,2})/);
  return m ? `${m[1]}${m[2].padStart(2, "0")}:00` : "+01:00";
}

// ── Chats ───────────────────────────────────────────────────────────────────

export const ladeChats = cache(async (): Promise<ChatDaten> => {
  const sb = createServiceClient();
  const vor = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const zaehle = async (von: string, bis?: string) => {
    let q = sb.from("chat_sessions").select("id", { count: "exact", head: true }).gt("created_at", von);
    if (bis) q = q.lte("created_at", bis);
    const { count } = await q;
    return count ?? 0;
  };
  const serieRows = async () => {
    const out: string[] = [];
    for (let from = 0; from < 5000; from += 1000) {
      const { data } = await sb.from("chat_sessions").select("created_at").gt("created_at", vor(30)).order("created_at").range(from, from + 999);
      for (const r of data ?? []) out.push(r.created_at as string);
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  const [d7, p7, d30, p30, wartend, rows] = await Promise.all([
    zaehle(vor(7)),
    zaehle(vor(14), vor(7)),
    zaehle(vor(30)),
    zaehle(vor(60), vor(30)),
    sb.from("chat_sessions").select("id", { count: "exact", head: true }).eq("status", "awaiting_human").then((r) => r.count ?? 0),
    serieRows(),
  ]);
  const proTag = new Map<string, number>();
  for (const iso of rows) {
    const tag = berlin.format(new Date(iso));
    proTag.set(tag, (proTag.get(tag) ?? 0) + 1);
  }
  const heute = heuteBerlin();
  const serie = Array.from({ length: 30 }, (_, i) => {
    const tag = plusTage(heute, i - 29);
    return { tag, n: proTag.get(tag) ?? 0 };
  });
  return { d7, p7, d30, p30, wartend, serie };
});

// ── Umsatz ──────────────────────────────────────────────────────────────────

interface UmsatzRow { monat: string; brutto: number; erstattet: number; netto: number; bestellungen: number; kanaele: Record<string, number> | null; stand: string }

const ladeUmsatzRows = cache(async (): Promise<UmsatzRow[]> => {
  const { data } = await createServiceClient().from("shopify_umsatz_monat").select("monat, brutto, erstattet, netto, bestellungen, kanaele, stand").order("monat");
  return ((data ?? []) as UmsatzRow[]).map((r) => ({ ...r, brutto: Number(r.brutto), erstattet: Number(r.erstattet), netto: Number(r.netto) }));
});

export const ladeUmsatz = cache(async (): Promise<UmsatzDaten> => {
  const heute = heuteBerlin();
  const monat = heute.slice(0, 7);
  const jahr = Number(heute.slice(0, 4));
  const tag = Number(heute.slice(8, 10));
  const mm = monat.slice(5);
  // Fairer Vergleich zum Vorjahr: dieselben Tage (1. bis gestern), gleicher Maßstab (Bestellwert).
  // Anteilig vom Vorjahresmonat wäre falsch — im November liegt Black Friday am Monatsende.
  // Tageswerte: dieser Monat bis jetzt + ganzer Vorjahresmonat (für die Tagesansicht im Fenster).
  const tageVergleich = async (): Promise<{ tv: UmsatzDaten["tageVergleich"]; tage: UmsatzDaten["tage"] }> => {
    try {
      const vjMonat = `${jahr - 1}-${mm}`;
      const [dieses, letztes] = await Promise.all([
        shopifyBestellwertJeTag(`${monat}-01`, plusTage(heute, 1)),
        shopifyBestellwertJeTag(`${vjMonat}-01`, plusTage(`${vjMonat}-${String(tageImMonat(vjMonat)).padStart(2, "0")}`, 1)),
      ]);
      const wert = (m: Record<string, number>, ym: string, t: number) => m[`${ym}-${String(t).padStart(2, "0")}`] ?? 0;
      const n = Math.max(tageImMonat(monat), tageImMonat(vjMonat));
      const tage = Array.from({ length: n }, (_, i) => ({
        tag: i + 1,
        dieses: i + 1 <= tag && i + 1 <= tageImMonat(monat) ? r0(wert(dieses, monat, i + 1)) : null,
        letztes: i + 1 <= tageImMonat(vjMonat) ? r0(wert(letztes, vjMonat, i + 1)) : null,
      }));
      const bis = (feld: "dieses" | "letztes") => tage.filter((x) => x.tag < tag).reduce((s, x) => s + (x[feld] ?? 0), 0);
      return { tv: tag < 2 ? null : { bisTag: tag - 1, dieses: bis("dieses"), letztes: bis("letztes") }, tage };
    } catch (e) {
      console.warn("[cockpit] Tagesvergleich:", e instanceof Error ? e.message : e);
      return { tv: null, tage: null };
    }
  };
  // Der laufende Monat kommt live aus Shopify: die Tabelle wird nur nachts gefüllt und kennt den
  // heutigen Tag nicht (13.11.2026: Tabelle 83.832 €, Shopify 116.732 € — Differenz = heutige Bestellungen).
  const live = holeShopifyUmsatzMonat(monat, Date.now() + 12_000).catch((e) => {
    console.warn("[cockpit] Umsatz live:", e instanceof Error ? e.message : e);
    return null;
  });
  const [tabelle, { tv, tage }, aktLive] = await Promise.all([ladeUmsatzRows(), tageVergleich(), live]);
  const rows = aktLive ? [...tabelle.filter((r) => r.monat !== monat), { ...aktLive, kanaele: aktLive.kanaele ?? null }] : tabelle;
  const by = new Map(rows.map((r) => [r.monat, r]));
  const akt = by.get(monat);
  const vj = by.get(`${jahr - 1}-${mm}`);
  const monatNetto = akt?.netto ?? 0;

  const monate = MONATE.map((m, i) => {
    const key = String(i + 1).padStart(2, "0");
    return { m, dieses: by.get(`${jahr}-${key}`)?.netto ?? null, letztes: by.get(`${jahr - 1}-${key}`)?.netto ?? null };
  });

  // Jahresvergleich nur über abgeschlossene Monate, die es in beiden Jahren gibt
  const gemeinsam = monate
    .map((x, i) => ({ ...x, i }))
    .filter((x) => x.i + 1 < Number(mm) && x.dieses != null && x.letztes != null);
  const vergleich = gemeinsam.length
    ? {
        label: gemeinsam.length === 1 ? gemeinsam[0].m : `${gemeinsam[0].m}–${gemeinsam[gemeinsam.length - 1].m}`,
        dieses: r0(gemeinsam.reduce((s, x) => s + (x.dieses ?? 0), 0)),
        letztes: r0(gemeinsam.reduce((s, x) => s + (x.letztes ?? 0), 0)),
      }
    : null;

  return {
    monat,
    monatNetto: r0(monatNetto),
    monatBestellungen: akt?.bestellungen ?? 0,
    vorjahrMonat: vj ? r0(vj.netto) : null,
    tageVergleich: tv,
    tage,
    hochrechnung: r0((monatNetto / Math.max(1, tag)) * tageImMonat(monat)),
    jahr,
    jahrNetto: r0(rows.filter((r) => r.monat.startsWith(String(jahr))).reduce((s, r) => s + r.netto, 0)),
    vergleich,
    monate,
    stand: akt?.stand ?? null,
    live: !!aktLive,
  };
});

// ── Shopify ─────────────────────────────────────────────────────────────────

/** Bestellwert (vor Erstattungen, ohne Tests/Stornos) der Bestellungen in [von, bis) — deutsche Zeit. */
/** Bestellwert (vor Erstattungen, ohne Tests/Stornos) je Kalendertag deutscher Zeit, [vonTag, bisTag). */
async function shopifyBestellwertJeTag(vonTag: string, bisTag: string): Promise<Record<string, number>> {
  const von = `${vonTag}T00:00:00${berlinOffset(vonTag)}`;
  const bis = `${bisTag}T00:00:00${berlinOffset(bisTag)}`;
  type Node = { createdAt: string; cancelledAt: string | null; test: boolean; totalPriceSet: { shopMoney: { amount: string } } };
  type Res = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: Node }> } };
  const out: Record<string, number> = {};
  let after: string | null = null;
  for (let seite = 0; seite < 40; seite++) {
    const res: { data?: Res } = await shopifyGraphQL<Res>(
      `query($q: String!, $after: String) { orders(first: 250, after: $after, query: $q) { pageInfo { hasNextPage endCursor } edges { node { createdAt cancelledAt test totalPriceSet { shopMoney { amount } } } } } }`,
      { q: `created_at:>='${von}' created_at:<'${bis}'`, after },
    );
    const orders: Res["orders"] | undefined = res.data?.orders;
    if (!orders) throw new Error("Shopify: keine Bestelldaten");
    for (const { node } of orders.edges) {
      if (node.test || node.cancelledAt) continue;
      const tag = new Date(node.createdAt).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
      out[tag] = (out[tag] ?? 0) + (Number(node.totalPriceSet.shopMoney.amount) || 0);
    }
    if (!orders.pageInfo.hasNextPage) return out;
    after = orders.pageInfo.endCursor;
  }
  throw new Error("Shopify: zu viele Bestellungen für die Tagesansicht");
}

async function shopifyTage(): Promise<Pick<ShopifyDaten, "heute" | "gestern">> {
  const heute = heuteBerlin();
  const gestern = plusTage(heute, -1);
  const von = `${gestern}T00:00:00${berlinOffset(gestern)}`;
  type Node = { createdAt: string; cancelledAt: string | null; test: boolean; currentTotalPriceSet: { shopMoney: { amount: string } } };
  type Res = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: Node }> } };
  const acc = { [heute]: { bestellungen: 0, umsatz: 0 }, [gestern]: { bestellungen: 0, umsatz: 0 } };
  let after: string | null = null;
  for (let seite = 0; seite < 4; seite++) {
    const res: { data?: Res } = await shopifyGraphQL<Res>(
      `query($q: String!, $after: String) { orders(first: 250, after: $after, query: $q) { pageInfo { hasNextPage endCursor } edges { node { createdAt cancelledAt test currentTotalPriceSet { shopMoney { amount } } } } } }`,
      { q: `created_at:>='${von}'`, after },
    );
    const orders: Res["orders"] | undefined = res.data?.orders;
    if (!orders) break;
    for (const { node } of orders.edges) {
      if (node.test || node.cancelledAt) continue;
      const t = acc[berlin.format(new Date(node.createdAt))];
      if (!t) continue;
      t.bestellungen++;
      t.umsatz += Number(node.currentTotalPriceSet.shopMoney.amount) || 0;
    }
    if (!orders.pageInfo.hasNextPage) break;
    after = orders.pageInfo.endCursor;
  }
  return {
    heute: { bestellungen: acc[heute].bestellungen, umsatz: r0(acc[heute].umsatz) },
    gestern: { bestellungen: acc[gestern].bestellungen, umsatz: r0(acc[gestern].umsatz) },
  };
}

const schoenerName = (handle: string) =>
  handle.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);

export const ladeShopify = cache(async (): Promise<ShopifyDaten> => {
  const sb = createServiceClient();
  const heute = heuteBerlin();
  const monat = heute.slice(0, 7);
  const [rows, tage, kunden, verkauf] = await Promise.all([
    ladeUmsatzRows(),
    shopifyTage().catch((e) => {
      console.warn("[cockpit] Shopify heute:", e instanceof Error ? e.message : e);
      return { heute: null, gestern: null };
    }),
    sb.from("kunden_segment_monat_v").select("monat, kunden, neue_kunden").order("monat", { ascending: false }).limit(8),
    (async () => {
      const out: Array<{ handle: string; units: number }> = [];
      for (let from = 0; from < 6000; from += 1000) {
        const { data } = await sb.from("shopify_variant_daily_sales").select("handle, units").gte("day", plusTage(heute, -30)).range(from, from + 999);
        for (const r of data ?? []) out.push(r as { handle: string; units: number });
        if (!data || data.length < 1000) break;
      }
      return out;
    })(),
  ]);

  const akt = rows.find((r) => r.monat === monat);
  const vor = [...rows].reverse().find((r) => r.monat < monat);
  // Aktueller Monat ist für Quoten zu jung (Erstattungen kommen später) → letzter voller Monat
  const basis = vor ?? akt;

  // Kunden: letzter voller Monat (der laufende ist unvollständig)
  type KRow = { monat: string; kunden: number; neue_kunden: number };
  const kRows = ((kunden.data ?? []) as KRow[]).map((k) => ({ ...k, m: berlin.format(new Date(k.monat)).slice(0, 7) }));
  const kMonat = kRows.map((k) => k.m).filter((m) => m < monat).sort().pop() ?? null;
  const kSum = kRows.filter((k) => k.m === kMonat).reduce((s, k) => ({ kunden: s.kunden + Number(k.kunden), neu: s.neu + Number(k.neue_kunden) }), { kunden: 0, neu: 0 });

  const proHandle = new Map<string, number>();
  for (const v of verkauf) if (v.handle) proHandle.set(v.handle, (proHandle.get(v.handle) ?? 0) + Number(v.units));
  const topseller = [...proHandle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h, stueck]) => ({ name: schoenerName(h), stueck }));

  return {
    ...tage,
    warenkorb: akt && akt.bestellungen ? r0(akt.brutto / akt.bestellungen) : null,
    warenkorbVormonat: vor && vor.bestellungen ? r0(vor.brutto / vor.bestellungen) : null,
    erstattungsQuote: basis && basis.brutto ? Math.round((basis.erstattet / basis.brutto) * 1000) / 10 : null,
    kanaele: Object.entries(basis?.kanaele ?? {}).map(([name, wert]) => ({ name, wert: r0(Number(wert)) })).sort((a, b) => b.wert - a.wert),
    neukundenAnteil: kSum.kunden ? Math.round((kSum.neu / kSum.kunden) * 100) : null,
    stammkundenAnteil: kSum.kunden ? 100 - Math.round((kSum.neu / kSum.kunden) * 100) : null,
    kundenMonat: kMonat,
    topseller,
  };
});

// ── Auslandsbestellungen ────────────────────────────────────────────────────

const landName = new Intl.DisplayNames(["de"], { type: "region" });
const nameVon = (code: string) => { try { return landName.of(code) ?? code; } catch { return code; } };
/** Montag der Woche eines Tages (YYYY-MM-DD). */
function montagVon(tag: string): string {
  const wt = new Date(`${tag}T12:00:00Z`).getUTCDay(); // 0 = So
  return plusTage(tag, wt === 0 ? -6 : 1 - wt);
}

async function auslandHeute(heute: string): Promise<(NonNullable<AuslandDaten["heute"]> & { proLand: Record<string, number> }) | null> {
  type Node = { cancelledAt: string | null; test: boolean; currentTotalPriceSet: { shopMoney: { amount: string } }; shippingAddress: { countryCodeV2: string | null } | null; billingAddress: { countryCodeV2: string | null } | null };
  type Res = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: Node }> } };
  const von = `${heute}T00:00:00${berlinOffset(heute)}`;
  let n = 0, umsatz = 0;
  const proLand: Record<string, number> = {};
  let after: string | null = null;
  for (let seite = 0; seite < 6; seite++) {
    const res: { data?: Res } = await shopifyGraphQL<Res>(
      `query($q: String!, $after: String) { orders(first: 250, after: $after, query: $q) { pageInfo { hasNextPage endCursor } edges { node { cancelledAt test currentTotalPriceSet { shopMoney { amount } } shippingAddress { countryCodeV2 } billingAddress { countryCodeV2 } } } } }`,
      { q: `created_at:>='${von}'`, after },
    );
    const orders: Res["orders"] | undefined = res.data?.orders;
    if (!orders) return null;
    for (const { node } of orders.edges) {
      if (node.test || node.cancelledAt) continue;
      const land = node.shippingAddress?.countryCodeV2 ?? node.billingAddress?.countryCodeV2;
      if (!land || land === "DE") continue;
      n++;
      umsatz += Number(node.currentTotalPriceSet.shopMoney.amount) || 0;
      proLand[land] = (proLand[land] ?? 0) + 1;
    }
    if (!orders.pageInfo.hasNextPage) break;
    after = orders.pageInfo.endCursor;
  }
  return { n, umsatz: r0(umsatz), laender: Object.keys(proLand).map(nameVon), proLand };
}

export const ladeAusland = cache(async (): Promise<AuslandDaten> => {
  const sb = createServiceClient();
  const heute = heuteBerlin();
  const montag = montagVon(heute);
  const ersteWoche = plusTage(montag, -11 * 7);
  // Tabelle wird nachts gefüllt (Stand = gestern); heute kommt live aus Shopify dazu.
  const ladeRows = async () => {
    const out: Array<{ created_at: string; land: string | null; umsatz_eur: number; storniert: boolean }> = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await sb.from("kunden_bestellungen").select("created_at, land, umsatz_eur, storniert")
        .gte("created_at", `${plusTage(ersteWoche, -1)}T00:00:00Z`).order("created_at").range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) out.push(r as (typeof out)[number]);
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  const [rows, live] = await Promise.all([
    ladeRows(),
    auslandHeute(heute).catch((e) => { console.warn("[cockpit] Ausland heute:", e instanceof Error ? e.message : e); return null; }),
  ]);

  type B = { tag: string; land: string; umsatz: number };
  const alle: B[] = []; // alle Bestellungen mit Lieferland (für den Anteil)
  for (const r of rows) {
    if (r.storniert || !r.land) continue;
    const tag = berlin.format(new Date(r.created_at));
    if (tag >= heute || tag < ersteWoche) continue;
    alle.push({ tag, land: r.land, umsatz: Number(r.umsatz_eur) });
  }
  const ausland = alle.filter((b) => b.land !== "DE");
  const standBis = alle.length ? alle[alle.length - 1].tag : null;

  const zw = (liste: B[], von: string, bis: string) => liste.filter((b) => b.tag >= von && b.tag <= bis);
  const summe = (l: B[]) => ({ n: l.length, umsatz: r0(l.reduce((s, b) => s + b.umsatz, 0)) });
  const gestern = plusTage(heute, -1);

  // Woche: Mo–gestern aus der Tabelle + heute live; Vorwoche Mo–selber Wochentag
  const wocheTab = summe(zw(ausland, montag, gestern));
  const vorWoche = summe(zw(ausland, plusTage(montag, -7), plusTage(heute, -7)));
  const woche = { n: wocheTab.n + (live?.n ?? 0), umsatz: wocheTab.umsatz + (live?.umsatz ?? 0), vorN: vorWoche.n, vorUmsatz: vorWoche.umsatz };

  const a28 = summe(zw(ausland, plusTage(heute, -28), gestern));
  const v28 = summe(zw(ausland, plusTage(heute, -56), plusTage(heute, -29)));
  const alle28 = zw(alle, plusTage(heute, -28), gestern).length;
  const alleV28 = zw(alle, plusTage(heute, -56), plusTage(heute, -29)).length;
  const pro = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

  // Länder: letzte 28 Tage gegen die 28 davor
  const proLand = new Map<string, { n: number; umsatz: number; vorN: number }>();
  for (const b of zw(ausland, plusTage(heute, -56), gestern)) {
    const e = proLand.get(b.land) ?? { n: 0, umsatz: 0, vorN: 0 };
    if (b.tag >= plusTage(heute, -28)) { e.n++; e.umsatz += b.umsatz; } else e.vorN++;
    proLand.set(b.land, e);
  }
  const laender = [...proLand.entries()]
    .map(([code, e]) => ({ code, name: nameVon(code), n: e.n, umsatz: r0(e.umsatz), vorN: e.vorN }))
    .sort((a, b) => b.n - a.n || b.vorN - a.vorN);

  // 12 Wochen, gestapelt nach den 3 stärksten Ländern des ganzen Zeitraums + Rest
  const gesamtProLand = new Map<string, number>();
  for (const b of ausland) gesamtProLand.set(b.land, (gesamtProLand.get(b.land) ?? 0) + 1);
  const top = [...gesamtProLand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
  const hatRest = gesamtProLand.size > top.length;
  const wochen: AuslandDaten["wochen"] = Array.from({ length: 12 }, (_, i) => {
    const start = plusTage(ersteWoche, i * 7);
    const w: AuslandDaten["wochen"][number] = { start, label: `${Number(start.slice(8, 10))}.${Number(start.slice(5, 7))}.` };
    for (const c of top) w[c] = 0;
    if (hatRest) w.rest = 0;
    return w;
  });
  for (const b of ausland) {
    const idx = Math.floor((Date.parse(`${b.tag}T12:00:00Z`) - Date.parse(`${ersteWoche}T12:00:00Z`)) / (7 * 86_400_000));
    const w = wochen[idx];
    if (!w) continue;
    const key = top.includes(b.land) ? b.land : "rest";
    w[key] = (Number(w[key]) || 0) + 1;
  }
  // heutige Bestellungen (live) in die laufende Woche des Diagramms
  const dieseWoche = wochen[wochen.length - 1];
  for (const [land, n] of Object.entries(live?.proLand ?? {})) {
    const key = top.includes(land) ? land : hatRest ? "rest" : null;
    if (key) dieseWoche[key] = (Number(dieseWoche[key]) || 0) + n;
  }
  return {
    heute: live ? { n: live.n, umsatz: live.umsatz, laender: live.laender } : null,
    woche,
    d28: { ...a28, vorN: v28.n, vorUmsatz: v28.umsatz, anteil: pro(a28.n, alle28), anteilVor: pro(v28.n, alleV28) },
    wochen,
    reihen: [...top.map((code) => ({ code, name: nameVon(code) })), ...(hatRest ? [{ code: "rest", name: "Übrige" }] : [])],
    laender,
    standBis,
  };
});

// ── Totes Kapital (Ladenhüter) — dieselbe Berechnung wie /stock/deadstock ───

export const ladeTotesKapital = cache(async (): Promise<TotesKapitalDaten> => {
  const alle = await loadDeadStock();
  const { totalLagerKg } = alle;
  // Gleiche Grenze wie die Seite /stock/deadstock: "fast tot" erst ab dieser Reichweite
  const items = alle.items.filter((d) => d.deadKind === "tot" || (d.monthsCover ?? 0) > FAST_TOT_STANDARD_MONATE);
  const teil = (l: typeof items) => ({
    wertEur: r0(l.reduce((s, d) => s + (d.valueEur ?? 0), 0)),
    kg: Math.round(l.reduce((s, d) => s + d.lagerG, 0) / 100) / 10,
    anzahl: l.length,
  });
  const gesamt = teil(items);
  const proKollektion = new Map<string, typeof items>();
  for (const d of items) proKollektion.set(d.collection, [...(proKollektion.get(d.collection) ?? []), d]);
  return {
    ...gesamt,
    anteilLager: totalLagerKg > 0 ? Math.round((gesamt.kg / totalLagerKg) * 1000) / 10 : 0,
    fastTotAbMonate: FAST_TOT_STANDARD_MONATE,
    tot: teil(items.filter((d) => d.deadKind === "tot")),
    fastTot: teil(items.filter((d) => d.deadKind === "fasttot")),
    ohnePreis: items.filter((d) => d.valueEur === null).length,
    kollektionen: [...proKollektion.entries()].map(([name, l]) => ({ name, ...teil(l) })).sort((a, b) => b.wertEur - a.wertEur).slice(0, 5),
    produkte: [...items]
      .sort((a, b) => (b.valueEur ?? 0) - (a.valueEur ?? 0))
      .slice(0, 5)
      .map((d) => ({ name: d.product, kollektion: d.collection, wertEur: r0(d.valueEur ?? 0), kg: Math.round(d.lagerG / 100) / 10, art: d.deadKind })),
  };
});

// ── Instagram ────────────────────────────────────────────────────────────────

export const ladeInstagram = cache(async (): Promise<InstagramDaten> => {
  const sb = createServiceClient();
  const heute = heuteBerlin();
  const [{ data: rows }, { data: stand }, live] = await Promise.all([
    sb.from("instagram_tag").select("tag, neu, verloren, follower, reichweite, profilaufrufe, website_klicks").gte("tag", plusTage(heute, -400)).order("tag"),
    sb.from("instagram_stand").select("demografie, online").eq("id", 1).maybeSingle(),
    holeFollowerLive(),
  ]);
  const tage = ((rows ?? []) as Array<Pick<InstagramTag, "tag" | "neu" | "verloren" | "follower" | "reichweite" | "profilaufrufe" | "website_klicks">>)
    .map((r) => ({ ...r, tag: String(r.tag).slice(0, 10) }));
  // Zeiträume am letzten Tag mit Follower-Zahlen ausrichten (Instagram liefert 1–2 Tage später)
  const mitDaten = tage.filter((t) => t.neu != null);
  const bisAm = mitDaten.length ? mitDaten[mitDaten.length - 1].tag : null;
  const fenster = (vonAb: number, bisAb: number) => (bisAm ? tage.filter((t) => t.tag > plusTage(bisAm, -vonAb) && t.tag <= plusTage(bisAm, -bisAb)) : []);
  const s = (l: typeof tage, k: "neu" | "verloren" | "reichweite" | "profilaufrufe" | "website_klicks") => l.reduce((a, t) => a + (t[k] ?? 0), 0);
  const a7 = fenster(7, 0), v7 = fenster(14, 7), a30 = fenster(30, 0), v30 = fenster(60, 30);
  const vor30 = bisAm ? tage.find((t) => t.tag === plusTage(bisAm, -30))?.follower ?? null : null;
  return {
    follower: live ?? [...tage].reverse().find((t) => t.follower != null)?.follower ?? null,
    followerVor30: vor30,
    tage: tage.map((t) => ({ tag: t.tag, neu: t.neu, verloren: t.verloren, follower: t.follower, reichweite: t.reichweite })),
    d7: {
      neu: s(a7, "neu"), verloren: s(a7, "verloren"), vorNeu: s(v7, "neu"), vorVerloren: s(v7, "verloren"),
      reichweite: s(a7, "reichweite"), vorReichweite: s(v7, "reichweite"), profil: s(a7, "profilaufrufe"), klicks: s(a7, "website_klicks"),
    },
    d30: { neu: s(a30, "neu"), verloren: s(a30, "verloren"), vorNeu: s(v30, "neu"), vorVerloren: s(v30, "verloren") },
    bisAm,
    demografie: (stand?.demografie as InstagramDaten["demografie"]) && Object.keys(stand?.demografie ?? {}).length ? (stand!.demografie as InstagramDaten["demografie"]) : null,
    online: stand?.online && Object.keys(stand.online).length ? (stand.online as Record<string, number>) : null,
  };
});

// ── Instagram-Anfragen (DMs) ─────────────────────────────────────────────────

export const ladeIgAnfragen = cache(async (): Promise<IgAnfragenDaten> => {
  const sb = createServiceClient();
  const jetzt = Date.now();
  const tag = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const heute = heuteBerlin();
  const heuteStart = Date.parse(`${heute}T00:00:00${berlinOffset(heute)}`);
  const zr = async (von: number, bis: number) => {
    const { data, error } = await sb.rpc("cockpit_ig_anfragen_zeitraum", { p_von: iso(von), p_bis: iso(bis) });
    if (error) throw new Error(error.message);
    const r = (data as Array<{ gespraeche: number; nachrichten: number }>)?.[0];
    return { gespraeche: r?.gespraeche ?? 0, nachrichten: r?.nachrichten ?? 0 };
  };
  const tageReihe = async (von: string, bis: string) => {
    const { data, error } = await sb.rpc("cockpit_ig_anfragen_tage", { p_von: von, p_bis: bis });
    if (error) throw new Error(error.message);
    const m = new Map(((data ?? []) as Array<{ tag: string; gespraeche: number }>).map((r) => [String(r.tag).slice(0, 10), r.gespraeche]));
    const out: Array<{ tag: string; n: number }> = [];
    for (let t = von; t <= bis; t = plusTage(t, 1)) out.push({ tag: t, n: m.get(t) ?? 0 });
    return out;
  };
  // Archiv beginnt im Mai 2025 — davor gibt es keinen Vorjahresvergleich
  const archivAb = Date.parse("2025-05-01T00:00:00+02:00");
  const periode = async (n: number): Promise<IgAnfragenPeriode> => {
    const vjBis = jetzt - 365 * tag;
    const [a, d, v, k] = await Promise.all([
      zr(jetzt - n * tag, jetzt),
      zr(jetzt - 2 * n * tag, jetzt - n * tag),
      vjBis - n * tag >= archivAb ? zr(vjBis - n * tag, vjBis) : Promise.resolve(null),
      sb.rpc("cockpit_ig_anfragen_kategorien", { p_von: iso(jetzt - n * tag), p_bis: iso(jetzt) }),
    ]);
    return { tage: n, ...a, davor: d, vorjahr: v, kategorien: ((k.data ?? []) as IgAnfragenPeriode["kategorien"]).slice(0, 8) };
  };
  const [h, vw, perioden, tage, tageVorjahr, stunden] = await Promise.all([
    zr(heuteStart, jetzt),
    zr(heuteStart - 7 * tag, jetzt - 7 * tag),
    Promise.all([7, 30, 90].map(periode)),
    tageReihe(plusTage(heute, -179), heute),
    tageReihe(plusTage(heute, -365 - 179), plusTage(heute, -365)),
    sb.rpc("cockpit_ig_anfragen_stunden", { p_von: iso(jetzt - 30 * tag) }),
  ]);
  return {
    heute: h,
    vorwoche: vw,
    perioden,
    tage,
    tageVorjahr,
    stunden: ((stunden.data ?? []) as Array<{ wochentag: number; stunde: number; nachrichten: number }>).map((r) => ({ wochentag: r.wochentag, stunde: r.stunde, n: r.nachrichten })),
  };
});

// ── Werbung (Meta / Google, aus dem Marketing-Projekt) ──────────────────────

export const ladeWerbung = cache(async (): Promise<WerbungDaten> => {
  const [lang, kurz] = await Promise.all([ladeWerbeteil(42), ladeWerbeteil(14)]);
  const metaStand = lang.aktualitaet?.meta_ads ? String(lang.aktualitaet.meta_ads).slice(0, 10) : null;
  const googleStand = lang.aktualitaet?.google_ads ? String(lang.aktualitaet.google_ads).slice(0, 10) : null;
  const tage = (lang.tage ?? []).map((t) => ({ datum: String(t.datum).slice(0, 10), meta: Number(t.meta_kosten) || 0, google: Number(t.google_kosten) || 0, umsatz: Number(t.umsatz) || 0 }));
  // Fenster am letzten Tag mit Meta-Daten ausrichten (das Marketing-Projekt holt sie mit Verzug)
  const ende = metaStand ?? heuteBerlin();
  const im = (von: number, bis: number) => tage.filter((t) => t.datum > plusTage(ende, -von) && t.datum <= plusTage(ende, -bis));
  const sum = (l: typeof tage, k: "meta" | "google" | "umsatz") => r0(l.reduce((s, t) => s + t[k], 0));
  const a = im(7, 0), v = im(14, 7);
  return {
    metaStand,
    googleStand,
    meta7: sum(a, "meta"),
    metaVor7: sum(v, "meta"),
    google7: sum(a, "google"),
    googleVor7: sum(v, "google"),
    umsatz7: sum(a, "umsatz"),
    tage,
    kampagnen: (kurz.werbung?.meta_kampagnen ?? []).filter((k) => Number(k.kosten) > 0).sort((x, y) => y.kosten - x.kosten)
      .map((k) => ({ name: k.kampagne, kosten: r0(k.kosten), klicks: k.klicks, impressionen: k.impressionen, reichweite: k.reichweite })),
    googleKampagnen: (kurz.werbung?.google_kampagnen ?? []).filter((k) => Number(k.kosten) > 0).map((k) => ({ name: k.kampagne, kosten: r0(k.kosten), klicks: k.klicks })),
  };
});

// ── Besucher & Conversion (ShopifyQL — braucht den Scope read_reports) ──────

export const ladeBesucher = cache(async (): Promise<BesucherDaten> => {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) return { verbunden: false, grund: "Shopify ist nicht verbunden." };
  try {
    const ql = "FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout SINCE -14d UNTIL -1d TIMESERIES day";
    const res = await fetch(`https://${domain}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) { tableData { columns { name } rows } parseErrors } }` }),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
      data?: { shopifyqlQuery: { tableData: { columns: Array<{ name: string }>; rows: unknown } | null; parseErrors: unknown } | null };
    };
    if (json.errors?.length) {
      const denied = json.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
      return { verbunden: false, grund: denied ? "scope" : json.errors[0].message };
    }
    const table = json.data?.shopifyqlQuery?.tableData;
    if (!table) return { verbunden: false, grund: "Shopify hat keine Besucherdaten geliefert." };
    const spalten = table.columns.map((c) => c.name);
    const roh = Array.isArray(table.rows) ? table.rows : [];
    // Zeilen kommen je nach API-Stand als Objekt oder als Array in Spaltenreihenfolge
    const zeilen = roh.map((r) => (Array.isArray(r) ? Object.fromEntries(spalten.map((s, i) => [s, r[i]])) : (r as Record<string, unknown>)));
    const num = (z: Record<string, unknown>, k: string) => Number(z[k]) || 0;
    const tage = zeilen
      .map((z) => ({
        tag: String(z.day ?? "").slice(0, 10),
        sitzungen: num(z, "sessions"),
        warenkorb: num(z, "sessions_with_cart_additions"),
        checkout: num(z, "sessions_that_reached_checkout"),
        kauf: num(z, "sessions_that_completed_checkout"),
      }))
      .filter((t) => t.tag)
      .sort((a, b) => a.tag.localeCompare(b.tag));
    if (!tage.length) return { verbunden: false, grund: "Shopify hat keine Besucherdaten geliefert." };
    const letzte = tage.slice(-7);
    const davor = tage.slice(-14, -7);
    const sum = (a: typeof tage, k: "sitzungen" | "warenkorb" | "checkout" | "kauf") => a.reduce((s, t) => s + t[k], 0);
    const quote = (a: typeof tage) => (sum(a, "sitzungen") ? Math.round((sum(a, "kauf") / sum(a, "sitzungen")) * 10000) / 100 : 0);
    return {
      verbunden: true,
      sitzungen7: sum(letzte, "sitzungen"),
      sitzungenVor7: sum(davor, "sitzungen"),
      conversion7: quote(letzte),
      conversionVor7: quote(davor),
      warenkorb7: sum(letzte, "warenkorb"),
      checkout7: sum(letzte, "checkout"),
      serie: tage.map((t) => ({ tag: t.tag, n: t.sitzungen })),
    };
  } catch (e) {
    return { verbunden: false, grund: e instanceof Error ? e.message : "Fehler beim Abruf" };
  }
});

// ── HY-Score (aus den täglichen Einträgen des Crons — schnell, kein Sheet-Abruf) ──

export const ladeHy = cache(async (): Promise<HyDaten | null> => {
  const { data } = await createServiceClient()
    .from("company_health_snapshots")
    .select("score, stock_kg_russian, stock_kg_uzbek, treatwell_eur, shopify_eur, targobank_eur, debt_eur, created_at")
    .not("score", "is", null)
    .order("created_at", { ascending: false })
    .limit(120);
  const rows = (data ?? []) as Array<{ score: number; stock_kg_russian: number | null; stock_kg_uzbek: number | null; treatwell_eur: number; shopify_eur: number; targobank_eur: number; debt_eur: number; created_at: string }>;
  if (!rows.length) return null;
  // ein Wert je Tag (der neueste)
  const proTag = new Map<string, number>();
  for (const r of rows) {
    const tag = berlin.format(new Date(r.created_at));
    if (!proTag.has(tag)) proTag.set(tag, Number(r.score));
  }
  const serie = [...proTag.entries()].map(([tag, score]) => ({ tag, score })).sort((a, b) => a.tag.localeCompare(b.tag)).slice(-60);
  const akt = rows[0];
  const score = Number(akt.score);
  const aktTag = berlin.format(new Date(akt.created_at));
  const vor = (n: number) => {
    const grenze = plusTage(aktTag, -n);
    const alt = [...serie].reverse().find((s) => s.tag <= grenze);
    return alt ? Math.round((score - alt.score) * 10) / 10 : null;
  };
  return {
    score,
    delta7: vor(7),
    delta30: vor(30),
    deltaSeit: vor(7) == null && serie.length > 1 ? { tag: serie[0].tag, delta: Math.round((score - serie[0].score) * 10) / 10 } : null,
    kg: Math.round((Number(akt.stock_kg_russian ?? 0) + Number(akt.stock_kg_uzbek ?? 0)) * 10) / 10,
    kontenEur: r0(Number(akt.treatwell_eur) + Number(akt.shopify_eur) + Number(akt.targobank_eur)),
    schuldenEur: r0(Number(akt.debt_eur)),
    stand: akt.created_at,
    serie,
  };
});

// ── Liquidität + Verpflichtungen ────────────────────────────────────────────

const ampelFuer = (saldo: number, puffer: number): Ampel => (saldo < 0 ? "alarm" : saldo < puffer ? "warn" : "ok");

export const ladeLiquiditaet = cache(async (): Promise<LiquiditaetDaten> => {
  const { roh, einstellungen, ergebnis } = await ladePrognose();
  // Punkte im Diagramm: Amanda, Ebru, USt, übrige Steuern, Einfuhrabgaben — je Tag und Gruppe eine Marke
  const ersterTag = ergebnis.tage[0]?.datum ?? roh.heute;
  const letzterTag = ergebnis.tage[ergebnis.tage.length - 1]?.datum ?? roh.heute;
  const proMarke = new Map<string, LiquiditaetDaten["marken"][number]>();
  for (const e of ergebnis.ereignisse) {
    if (e.betrag >= 0) continue;
    const g = zahlGruppe(e);
    if (!g) continue;
    const gruppe: LiqGruppe = g === "steuern" ? (e.steuer === "ust" ? "ust" : "steuer") : g;
    const datum = e.datum < ersterTag ? ersterTag : e.datum; // überfällig → heute
    if (datum > letzterTag) continue;
    const key = `${datum}|${gruppe}`;
    const m = proMarke.get(key);
    if (m) {
      m.betrag += r0(e.betrag);
      if (!m.label.includes(e.label)) m.label = `${m.label} · ${e.label}`.slice(0, 140);
      m.geschaetzt = m.geschaetzt || !!e.schaetzung;
    } else proMarke.set(key, { datum, betrag: r0(e.betrag), label: e.label, gruppe, geschaetzt: !!e.schaetzung });
  }
  const marken = [...proMarke.values()].sort((a, b) => a.datum.localeCompare(b.datum));
  return {
    heute: roh.heute,
    start: r0(ergebnis.startSaldoGesamt),
    puffer: einstellungen.puffer,
    tiefpunkt: { datum: ergebnis.tiefpunkt.datum, saldo: r0(ergebnis.tiefpunkt.saldo) },
    ampel: ampelFuer(ergebnis.tiefpunkt.saldo, einstellungen.puffer),
    tage: ergebnis.tage.map((t) => ({ datum: t.datum, saldo: r0(t.saldo) })),
    marken,
  };
});

// ── Steuerkasse: Zahlungen ans Finanzamt ────────────────────────────────────

const STEUER_TITEL: Record<SteuerArt, string> = { ust: "Umsatzsteuer", lst: "Lohnsteuer", est: "Einkommensteuer", gewst: "Gewerbesteuer" };

/** "USt-VA 2026-09 (Soll …)" → "Sep 2026"; "ESt-Vorauszahlung Q4 2026" → "Q4 2026". */
function steuerZeitraum(label: string): string {
  const m = label.match(/(\d{4})-(\d{2})/);
  if (m) return `${MONATE[Number(m[2]) - 1]} ${m[1]}`;
  const q = label.match(/Q[1-4] \d{4}/);
  return q ? q[0] : "";
}

export const ladeSteuerKasse = cache(async (horizont = 100): Promise<SteuerKasseDaten> => {
  const { roh, einstellungen, ergebnis } = await ladePrognose();
  const heute = roh.heute;
  const bis = plusTage(heute, horizont);
  const saldoAm = new Map(ergebnis.tage.map((t) => [t.datum, t.saldo]));
  const erster = ergebnis.tage[0]?.datum ?? heute;
  const start = ergebnis.startSaldoGesamt;
  const proTag = new Map<string, SteuerKasseDaten["termine"][number]>();
  for (const e of ergebnis.ereignisse) {
    if (e.art !== "steuer" || !e.steuer || e.datum > bis) continue;
    const datum = e.datum < erster ? erster : e.datum;
    let t = proTag.get(datum);
    if (!t) {
      const vorher = saldoAm.get(plusTage(datum, -1)) ?? start;
      t = {
        datum,
        tageBis: Math.max(0, Math.round((Date.parse(datum) - Date.parse(heute)) / 86_400_000)),
        ueberfaellig: false,
        posten: [],
        summe: 0,
        kontoVorher: r0(datum <= erster ? start : vorher),
        kontoNachher: 0, // unten: davor minus Steuer (andere Zahlungen desselben Tages bleiben außen vor)
      };
      proTag.set(datum, t);
    }
    t.ueberfaellig = t.ueberfaellig || !!e.sofort;
    t.posten.push({ art: e.steuer, titel: e.betrag > 0 ? `Erstattung ${e.steuer === "ust" ? "USt" : STEUER_TITEL[e.steuer]}` : STEUER_TITEL[e.steuer], zeitraum: steuerZeitraum(e.label), betrag: r0(-e.betrag), geschaetzt: !!e.schaetzung, rechnung: (e.rechnung ?? []).map((x) => ({ text: x.text, betrag: r0(x.betrag) })) });
    t.summe += r0(-e.betrag);
  }
  const termine = [...proTag.values()].sort((a, b) => a.datum.localeCompare(b.datum));
  for (const t of termine) t.kontoNachher = t.kontoVorher - t.summe;
  const jeArt = (["ust", "lst", "est", "gewst"] as SteuerArt[])
    .map((art) => ({ art, betrag: termine.flatMap((t) => t.posten).filter((p) => p.art === art && p.betrag > 0).reduce((s, p) => s + p.betrag, 0) }))
    .filter((x) => x.betrag > 0);
  const alle = termine.flatMap((t) => t.posten);

  // Einkommen-/Gewerbesteuer des laufenden Jahres aus dem Steuer-Ledger: bezahlt = Ist mit Datum,
  // offen = Soll bzw. (ohne Soll) der zuletzt bezahlte Quartalsbetrag dieser Steuer.
  const jahrNr = Number(heute.slice(0, 4));
  const { data: ledger } = await createServiceClient()
    .from("steuer_posten")
    .select("art, zeitraum, jahr, richtung, soll_betrag, faellig_am, ist_betrag, bezahlt_am")
    .in("art", ["est_vz", "gewst_vz", "est_nachzahlung", "gewst_nachzahlung"])
    .in("jahr", [jahrNr - 1, jahrNr]);
  type LP = { art: string; zeitraum: string; jahr: number; richtung: string; soll_betrag: number | null; faellig_am: string | null; ist_betrag: number | null; bezahlt_am: string | null };
  const lp = (ledger ?? []) as LP[];
  const arten = (["est", "gewst"] as const).map((art) => {
    const eigene = lp.filter((p) => p.art.startsWith(`${art}_`));
    const letzter = eigene
      .filter((p) => p.art === `${art}_vz` && p.bezahlt_am && Number(p.ist_betrag) > 0)
      .sort((a, b) => String(a.bezahlt_am).localeCompare(String(b.bezahlt_am)))
      .at(-1);
    const posten = eigene
      .filter((p) => p.jahr === jahrNr)
      .map((p) => {
        const vz = p.art === `${art}_vz`;
        const vorz = p.richtung === "erstattung" ? -1 : 1;
        const bezahlt = !!p.bezahlt_am;
        const soll = Number(p.soll_betrag ?? 0);
        const roh = bezahlt ? Number(p.ist_betrag ?? soll) : soll > 0 ? soll : vz ? Number(letzter?.ist_betrag ?? 0) : 0;
        return {
          zeitraum: vz ? p.zeitraum.slice(0, 2) : "Nachzahlung",
          faellig: p.faellig_am ? String(p.faellig_am).slice(0, 10) : null,
          betrag: r0(roh * vorz),
          bezahlt,
          bezahltAm: p.bezahlt_am ? String(p.bezahlt_am).slice(0, 10) : null,
          // Vorauszahlungen sind festgesetzt: ohne Soll gilt der letzte Quartalsbetrag, keine Schätzung
          geschaetzt: !bezahlt && soll <= 0 && !vz,
        };
      })
      .filter((p) => p.betrag !== 0 || p.zeitraum !== "Nachzahlung")
      .sort((a, b) => (a.faellig ?? "").localeCompare(b.faellig ?? "") || a.zeitraum.localeCompare(b.zeitraum));
    return {
      art,
      posten,
      bezahlt: posten.filter((p) => p.bezahlt).reduce((s, p) => s + p.betrag, 0),
      offen: posten.filter((p) => !p.bezahlt).reduce((s, p) => s + p.betrag, 0),
    };
  }).filter((a) => a.posten.length);

  // Hochrechnung: Gewinn der abgeschlossenen Monate (Finanzübersicht, gleiche Rechnung) aufs Jahr,
  // darauf ESt (inkl. Soli) + GewSt wie in der Übersicht, minus Vorauszahlungen = Nachzahlung.
  let prognose: SteuerKasseDaten["jahr"]["prognose"] = null;
  try {
    const sb = createServiceClient();
    const [rowsRes, shopRes, salon] = await Promise.all([
      sb.from("finanz_monatsdaten").select("*").eq("jahr", jahrNr).order("monat"),
      sb.from("shopify_umsatz_monat").select("monat, netto").gte("monat", `${jahrNr}-01`).lte("monat", `${jahrNr}-12`),
      salonUmsatzJahr(jahrNr),
    ]);
    if (rowsRes.error) throw new Error(rowsRes.error.message);
    const rows = (rowsRes.data ?? []) as FinanzMonatsdaten[];
    const shop = ((shopRes.data ?? []) as Array<{ monat: string; netto: number }>).map((u) => ({ monat: String(u.monat), netto: Number(u.netto) || 0 }));
    const aktMonat = Number(heute.slice(5, 7));
    const fertig = rows.filter((r) => r.monat < aktMonat).sort((a, b) => a.monat - b.monat);
    if (fertig.length) {
      const ym = (m: number) => `${jahrNr}-${String(m).padStart(2, "0")}`;
      let gewinnBisher = 0;
      for (const r of fertig) {
        let inp = r.daten;
        const u = shop.find((x) => x.monat === ym(r.monat));
        const sa = salon.find((x) => x.monat === ym(r.monat));
        if (!inp.shopManuell && u) inp = { ...inp, shopBrutto: u.netto };
        if (!inp.salonManuell && sa) inp = { ...inp, salonBrutto: sa.brutto };
        gewinnBisher += compute(inp, jahrNr).gewinnVorSteuern;
      }
      const letzte = fertig[fertig.length - 1].daten;
      const gewinnJahr = (gewinnBisher / fertig.length) * 12;
      const tax = taxChain(gewinnJahr, letzte.gewstHebesatz, letzte.gewstFreibetrag, jahrNr);
      const vz = (art: "est" | "gewst") => { const a = arten.find((x) => x.art === art); return a ? a.bezahlt + a.offen : 0; };
      prognose = {
        monate: fertig.length,
        bisMonat: ym(fertig[fertig.length - 1].monat),
        gewinnBisher: r0(gewinnBisher),
        gewinnJahr: r0(gewinnJahr),
        est: r0(tax.estGesamt),
        gewst: r0(tax.gewstJahr),
        vzEst: vz("est"),
        vzGewst: vz("gewst"),
        nachEst: r0(tax.estGesamt - vz("est")),
        nachGewst: r0(tax.gewstJahr - vz("gewst")),
      };
    }
  } catch (e) {
    console.warn("[steuerkasse] Gewinn-Hochrechnung:", e instanceof Error ? e.message : e);
  }

  return {
    heute,
    konto: r0(start),
    puffer: einstellungen.puffer,
    tageHorizont: horizont,
    termine,
    jeArt,
    zahlungen: alle.filter((p) => p.betrag > 0).reduce((s, p) => s + p.betrag, 0),
    erstattungen: -alle.filter((p) => p.betrag < 0).reduce((s, p) => s + p.betrag, 0),
    jahr: { jahr: jahrNr, arten, bezahlt: arten.reduce((s, a) => s + a.bezahlt, 0), offen: arten.reduce((s, a) => s + a.offen, 0), prognose },
  };
});

const PERSONAL = new Set(["aus_personal", "aus_sozialversicherung", "umbuchung_gehalt"]);
const FIX = new Set(["aus_miete", "aus_energie", "aus_telefon", "aus_versicherung", "aus_software", "aus_steuerberater", "aus_beitraege"]);

export const ladePflichten = cache(async (tage = 30): Promise<PflichtenDaten> => {
  const { roh, einstellungen, ergebnis } = await ladePrognose();
  const bis = plusTage(roh.heute, tage);
  const posten: PflichtPosten[] = [];

  // Laufende Kosten: Ø der letzten Monate aus den Kontoumsätzen (wie in der Liquiditätsvorschau)
  const aus = new Set(einstellungen.ausgeblendeteKategorien);
  const gruppen = { personal: 0, fixkosten: 0, gebuehren: 0, sonstiges: 0 };
  for (const l of roh.basis.laufend) {
    if (aus.has(l.kategorie)) continue;
    const anteil = (-l.summe / Math.max(1, roh.basis.tage)) * tage;
    if (PERSONAL.has(l.kategorie)) gruppen.personal += anteil;
    else if (FIX.has(l.kategorie)) gruppen.fixkosten += anteil;
    else if (l.kategorie === "aus_bank") gruppen.gebuehren += anteil;
    else gruppen.sonstiges += anteil;
  }

  const inZeit = ergebnis.ereignisse.filter((e) => e.betrag < 0 && e.datum <= bis);
  const sum = (arten: string[]) => -inZeit.filter((e) => arten.includes(e.art)).reduce((s, e) => s + e.betrag, 0);
  const geschaetzt = (arten: string[]) => inZeit.some((e) => arten.includes(e.art) && e.schaetzung);

  const add = (gruppe: PflichtPosten["gruppe"], label: string, betrag: number, g: boolean) => {
    if (betrag >= 1) posten.push({ gruppe, label, betrag: r0(betrag), geschaetzt: g });
  };
  add("steuern", "Steuern (USt, Lohnsteuer, ESt, GewSt)", sum(["steuer"]), geschaetzt(["steuer"]));
  add("personal", "Löhne & Sozialabgaben", gruppen.personal, true);
  add("fixkosten", "Fixkosten (Miete, Energie, Software …)", gruppen.fixkosten, true);
  add("gebuehren", "Bank- & Zahlungsgebühren", gruppen.gebuehren, true);
  add("lieferanten", "Lieferanten (Amanda, Ebru-Raten)", sum(["lieferant", "manuell", "nachbestellung"]), geschaetzt(["nachbestellung"]));
  add("einfuhr", "Einfuhrabgaben (EUSt, Zoll)", sum(["einfuhr"]), true);
  add("sonstiges", "Übrige laufende Ausgaben", gruppen.sonstiges, true);

  const imZeitraum = ergebnis.tage.filter((t) => t.datum <= bis);
  const tief = imZeitraum.reduce((a, b) => (b.saldo < a.saldo ? b : a), imZeitraum[0] ?? { datum: roh.heute, saldo: ergebnis.startSaldoGesamt });

  return {
    tage,
    verfuegbar: r0(ergebnis.startSaldoGesamt),
    einnahmenErwartet: r0(ergebnis.einnahmenProTag * tage),
    posten,
    summe: posten.reduce((s, p) => s + p.betrag, 0),
    tiefpunkt: { datum: tief.datum, saldo: r0(tief.saldo) },
    puffer: einstellungen.puffer,
    ampel: ampelFuer(tief.saldo, einstellungen.puffer),
    termine: inZeit
      .filter((e) => -e.betrag >= 1000)
      .sort((a, b) => a.datum.localeCompare(b.datum))
      .slice(0, 8)
      .map((e) => ({ datum: e.datum, label: e.label, betrag: r0(-e.betrag), geschaetzt: !!e.schaetzung })),
  };
});

// ── Aktionen ────────────────────────────────────────────────────────────────

export const ladeKampagnen = cache(async (): Promise<KampagneDaten[]> => {
  const sb = createServiceClient();
  const heute = heuteBerlin();
  const [{ data: camps }, { data: einst }] = await Promise.all([
    sb.from("chatbot_campaigns").select("id, name, starts_on, ends_on, color, note").order("starts_on", { ascending: false }).limit(20),
    sb.from("liquiditaet_einstellungen").select("daten").eq("id", 1).maybeSingle(),
  ]);
  const out: KampagneDaten[] = [];
  for (const c of (camps ?? []) as Array<{ id: string; name: string; starts_on: string; ends_on: string | null; color: string; note: string | null }>) {
    const von = String(c.starts_on).slice(0, 10);
    const bis = c.ends_on ? String(c.ends_on).slice(0, 10) : null;
    // laufend oder kommend (oder in den letzten 7 Tagen beendet)
    if ((bis ?? von) < plusTage(heute, -7)) continue;
    out.push({ id: c.id, name: c.name, von, bis, farbe: c.color, notiz: c.note, quelle: "chatbot" });
  }
  type LiqAkt = { aktiv: boolean; label: string; von: string; bis: string; mehrumsatzBrutto: number };
  const ld = einst?.daten as { aktion?: LiqAkt | null; weitereAktionen?: LiqAkt[] } | null;
  // Black Friday + weitere geplante Aktionen (Sales) aus der Liquiditätsvorschau
  for (const [i, aktion] of [ld?.aktion, ...(ld?.weitereAktionen ?? [])].entries()) {
    if (!aktion?.aktiv || aktion.bis < plusTage(heute, -7)) continue;
    out.push({
      id: i === 0 ? "liq-aktion" : `liq-aktion-${i}`,
      name: aktion.label,
      von: aktion.von,
      bis: aktion.bis,
      farbe: "#f59e0b",
      notiz: `In der Liquiditätsvorschau mit ${new Intl.NumberFormat("de-DE").format(aktion.mehrumsatzBrutto)} € Mehrumsatz eingeplant`,
      quelle: "liquiditaet",
    });
  }
  return out.sort((a, b) => a.von.localeCompare(b.von));
});

// ── Einträge + Layout ───────────────────────────────────────────────────────

export async function ladeEintraege(userId: string): Promise<Eintrag[]> {
  const sb = createServiceClient();
  const [{ data }, { data: profile }] = await Promise.all([
    sb.from("cockpit_eintraege")
      .select("id, art, owner_id, titel, text, daten, erledigt_am, sort, created_at")
      .or(`art.neq.notiz,owner_id.eq.${userId}`)
      .order("sort")
      .order("created_at")
      .limit(1000),
    sb.from("profiles").select("id, display_name, username"),
  ]);
  const namen = new Map(((profile ?? []) as Array<{ id: string; display_name: string | null; username: string | null }>).map((p) => [p.id, p.display_name ?? p.username ?? null]));
  return ((data ?? []) as Array<Omit<Eintrag, "owner_name"> & { art: EintragArt }>).map((e) => ({
    ...e,
    daten: e.daten ?? {},
    owner_name: e.owner_id ? namen.get(e.owner_id) ?? null : null,
  }));
}

export async function ladeTeam(): Promise<string[]> {
  const { data } = await createServiceClient().from("profiles").select("display_name, role, approved").neq("role", "supplier");
  return ((data ?? []) as Array<{ display_name: string | null; approved: boolean }>)
    .map((p) => p.display_name?.trim())
    .filter((n): n is string => !!n && n !== "Test" && n !== "Admin")
    .sort((a, b) => a.localeCompare(b));
}

export async function ladeLayout(userId: string): Promise<CockpitLayout | null> {
  const { data } = await createServiceClient().from("cockpit_layout").select("layout").eq("user_id", userId).maybeSingle();
  const l = data?.layout as Partial<CockpitLayout> | null | undefined;
  if (!l || !Array.isArray(l.items)) return null;
  return {
    items: l.items, aus: Array.isArray(l.aus) ? l.aus : [], adern: l.adern !== false,
    abstand: typeof l.abstand === "number" ? Math.max(4, Math.min(32, Math.round(l.abstand))) : 12,
    stil: l.stil === "glas" || l.stil === "aurora" ? l.stil : "standard",
    raster: l.raster === 2 ? 2 : undefined,
  };
}

// ── Lagebild: wo läuft es, wo hakt es ───────────────────────────────────────

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const kurzDatum = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
const prozent = (neu: number, alt: number) => (alt ? Math.round(((neu - alt) / alt) * 100) : 0);

export async function ladeSignale(opts: { finanzen: boolean; chatbot: boolean }): Promise<Signal[]> {
  const sb = createServiceClient();
  const heute = heuteBerlin();
  const out: Signal[] = [];
  const sicher = async <T,>(p: Promise<T>): Promise<T | null> => {
    try { return await p; } catch (e) { console.warn("[cockpit] Lagebild:", e instanceof Error ? e.message : e); return null; }
  };

  const [liq, umsatz, hy, chats, steuern, aufgaben] = await Promise.all([
    opts.finanzen ? sicher(ladeLiquiditaet()) : null,
    opts.finanzen ? sicher(ladeUmsatz()) : null,
    opts.finanzen ? sicher(ladeHy()) : null,
    opts.chatbot ? sicher(ladeChats()) : null,
    opts.finanzen
      ? sb.from("steuer_posten").select("art, zeitraum, soll_betrag, faellig_am").is("bezahlt_am", null).eq("richtung", "zahlung").gt("soll_betrag", 0).lt("faellig_am", heute).then((r) => r.data ?? [])
      : [],
    sb.from("cockpit_eintraege").select("titel, daten").eq("art", "aufgabe").is("erledigt_am", null).then((r) => r.data ?? []),
  ]);

  if (liq) {
    const t = liq.tiefpunkt;
    out.push(
      liq.ampel === "alarm"
        ? { ampel: "alarm", titel: "Liquiditätslücke", detail: `Am ${kurzDatum(t.datum)} fehlen ${eur(-t.saldo)}`, href: "/finances/liquiditaet" }
        : liq.ampel === "warn"
          ? { ampel: "warn", titel: "Liquidität knapp", detail: `Tiefpunkt ${eur(t.saldo)} am ${kurzDatum(t.datum)} – unter der Reserve von ${eur(liq.puffer)}`, href: "/finances/liquiditaet" }
          : { ampel: "ok", titel: "Liquidität gesichert", detail: `Tiefpunkt ${eur(t.saldo)} am ${kurzDatum(t.datum)}`, href: "/finances/liquiditaet" },
    );
  }
  if (steuern.length) {
    const summe = (steuern as Array<{ soll_betrag: number }>).reduce((s, p) => s + Number(p.soll_betrag), 0);
    out.push({ ampel: "alarm", titel: `${steuern.length} Steuerzahlung${steuern.length === 1 ? "" : "en"} überfällig`, detail: `${eur(summe)} laut Steuer-Ledger noch offen`, href: "/finances/prepayments" });
  }
  if (umsatz?.tageVergleich && umsatz.tageVergleich.letztes > 0) {
    const tv = umsatz.tageVergleich;
    const p = prozent(tv.dieses, tv.letztes);
    out.push({
      ampel: p <= -25 ? "alarm" : p < -8 ? "warn" : "ok",
      titel: p < -8 ? "Bestellungen unter Vorjahr" : p > 8 ? "Bestellungen über Vorjahr" : "Bestellungen auf Vorjahresniveau",
      detail: `${p >= 0 ? "+" : ""}${p} % Bestellwert zum Vorjahr (1.–${tv.bisTag}. des Monats)`,
      href: "/finances/overview",
    });
  }
  if (chats) {
    if (chats.wartend > 0) out.push({ ampel: chats.wartend >= 5 ? "alarm" : "warn", titel: `${chats.wartend} Chat${chats.wartend === 1 ? " wartet" : "s warten"} auf einen Menschen`, detail: "Kundinnen warten auf eine Antwort vom Team", href: "/chatbot/inbox" });
    else out.push({ ampel: "ok", titel: "Kein Chat wartet", detail: `${chats.d7} neue Chats in 7 Tagen`, href: "/chatbot/inbox" });
  }
  const offen = aufgaben as Array<{ titel: string; daten: { faellig?: string; prio?: string } | null }>;
  const ueber = offen.filter((a) => a.daten?.faellig && a.daten.faellig < heute);
  if (ueber.length) out.push({ ampel: "alarm", titel: `${ueber.length} Aufgabe${ueber.length === 1 ? "" : "n"} überfällig`, detail: ueber.slice(0, 2).map((a) => a.titel).join(" · ") });
  else if (offen.length) out.push({ ampel: "ok", titel: `${offen.length} offene Aufgabe${offen.length === 1 ? "" : "n"}`, detail: "Keine davon überfällig" });
  const hyDelta = hy ? (hy.delta7 != null ? { d: hy.delta7, text: "in 7 Tagen" } : hy.deltaSeit ? { d: hy.deltaSeit.delta, text: `seit ${kurzDatum(hy.deltaSeit.tag)}` } : null) : null;
  if (hy && hyDelta) {
    out.push({
      ampel: hyDelta.d < -25 ? "warn" : "ok",
      titel: `HY-Score ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(hy.score)}`,
      detail: `${hyDelta.d >= 0 ? "+" : ""}${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(hyDelta.d)} ${hyDelta.text}`,
      href: "/health",
    });
  }

  const rang: Record<Ampel, number> = { alarm: 0, warn: 1, ok: 2 };
  return out.sort((a, b) => rang[a.ampel] - rang[b.ampel]);
}

// ── Gewerbekunden ───────────────────────────────────────────────────────────

export const ladeGewerbe = cache(async (): Promise<GewerbeDaten> => {
  const sb = createServiceClient();
  const markiert = await ladeGewerbeMarkiert();
  const ids = markiert.map((k) => k.id);
  const registriert = markiert.length;
  const [mon, kz] = await Promise.all([
    sb.rpc("cockpit_gewerbe_monate", { p_ids: ids, p_monate: 13 }),
    sb.rpc("cockpit_gewerbe_kennzahlen", { p_ids: ids }),
  ]);
  if (mon.error) throw new Error(mon.error.message);
  if (kz.error) throw new Error(kz.error.message);
  const k = (kz.data as Array<Record<string, number>>)[0] ?? {};
  const monate = ((mon.data ?? []) as Array<{ monat: string; aktive: number; neue: number; bestellungen: number; umsatz_b2b: number; umsatz_gesamt: number }>).map((m) => ({
    monat: m.monat, aktive: m.aktive, neue: m.neue, bestellungen: m.bestellungen, umsatz: r0(Number(m.umsatz_b2b)),
    anteil: Number(m.umsatz_gesamt) > 0 ? Number(m.umsatz_b2b) / Number(m.umsatz_gesamt) : 0,
  }));
  const voll = monate.slice(-4, -1);
  const b2b3 = voll.reduce((s, m) => s + m.umsatz, 0);
  const ges3 = voll.reduce((s, m) => s + (m.anteil > 0 ? m.umsatz / m.anteil : 0), 0);
  return {
    registriert,
    kaeufer: Number(k.kaeufer ?? 0),
    aktiv30: Number(k.aktiv30 ?? 0),
    aktiv90: Number(k.aktiv90 ?? 0),
    aktiv90Vorjahr: Number(k.aktiv90_vorjahr ?? 0),
    umsatz90: r0(Number(k.umsatz90 ?? 0)),
    bestellungen90: Number(k.bestellungen90 ?? 0),
    anteil: ges3 > 0 ? b2b3 / ges3 : 0,
    monate,
  };
});
