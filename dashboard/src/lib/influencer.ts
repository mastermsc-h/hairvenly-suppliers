// Influencer-Tracking: eingetragene Influencer/Postings (unsere DB) + automatische
// Code-Nutzung aus Shopify + geschätzter Posting-Effekt auf den Tagesumsatz.
import "server-only";
import { unstable_cache } from "next/cache";
import { shopifyGraphQL } from "@/lib/shopify";
import { ladeTagesUmsatz } from "@/lib/marketing-extern";

export type Plattform = "instagram" | "tiktok" | "youtube" | "sonstiges";
export type PostingArt = "reel" | "story" | "post" | "video" | "live" | "sonstiges";

export interface Influencer {
  id: string;
  name: string;
  handle: string | null;
  plattform: Plattform;
  rabattcode: string | null;
  aktiv_von: string | null;
  aktiv_bis: string | null;
  kosten_eur: number | null;
  verguetung: string | null;
  notiz: string | null;
  created_at: string;
}

export interface Posting {
  id: string;
  influencer_id: string;
  datum: string;
  art: PostingArt;
  link: string | null;
  notiz: string | null;
}

/** Eine Bestellung mit Rabattcode (aus Shopify). */
export interface CodeBestellung {
  datum: string; // YYYY-MM-DD (Berlin)
  summe: number;
  codes: string[]; // UPPERCASE, getrimmt
}

const berlinTag = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(iso));
export const normCode = (c: string) => c.trim().toUpperCase();

/**
 * Alle Shopify-Bestellungen mit Rabattcode der letzten `tage` Tage (ohne stornierte).
 * 30 Min gecacht — Shopify-Abfrage ist seitenweise (250/Seite).
 */
export const ladeCodeBestellungen = unstable_cache(
  async (tage: number): Promise<CodeBestellung[]> => {
    const seit = new Date(Date.now() - tage * 86400000).toISOString().slice(0, 10);
    const out: CodeBestellung[] = [];
    let after: string | null = null;
    for (let seite = 0; seite < 60; seite++) {
      const r: Awaited<ReturnType<typeof shopifyGraphQL<{
        orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { createdAt: string; cancelledAt: string | null; discountCodes: string[]; totalPriceSet: { shopMoney: { amount: string } } }[] };
      }>>> = await shopifyGraphQL(
        `query($a: String, $q: String) {
          orders(first: 250, after: $a, query: $q, sortKey: CREATED_AT) {
            pageInfo { hasNextPage endCursor }
            nodes { createdAt cancelledAt discountCodes totalPriceSet { shopMoney { amount } } }
          }
        }`,
        { a: after, q: `created_at:>=${seit} discount_code:*` },
      );
      if (r.errors?.length || !r.data) throw new Error(`Shopify: ${r.errors?.[0]?.message ?? "keine Daten"}`);
      for (const o of r.data.orders.nodes) {
        if (o.cancelledAt || !o.discountCodes.length) continue;
        out.push({ datum: berlinTag(o.createdAt), summe: Number(o.totalPriceSet.shopMoney.amount), codes: o.discountCodes.map(normCode) });
      }
      if (!r.data.orders.pageInfo.hasNextPage) break;
      after = r.data.orders.pageInfo.endCursor;
    }
    return out;
  },
  ["influencer-code-bestellungen-v1"],
  { revalidate: 1800 },
);

// ── Auswertung ───────────────────────────────────────────────────────

export interface CodeStat {
  bestellungen: number;
  umsatz: number;
  letzte7: number;
  letzte30: number;
  ersteNutzung: string | null;
  letzteNutzung: string | null;
}

export function codeStatistik(bestellungen: CodeBestellung[], code: string, heute: string, von?: string | null, bis?: string | null): CodeStat {
  const c = normCode(code);
  const t7 = verschiebe(heute, -6);
  const t30 = verschiebe(heute, -29);
  const s: CodeStat = { bestellungen: 0, umsatz: 0, letzte7: 0, letzte30: 0, ersteNutzung: null, letzteNutzung: null };
  for (const b of bestellungen) {
    if (!b.codes.includes(c)) continue;
    if (von && b.datum < von) continue;
    if (bis && b.datum > bis) continue;
    s.bestellungen++;
    s.umsatz += b.summe;
    if (b.datum >= t7) s.letzte7++;
    if (b.datum >= t30) s.letzte30++;
    if (!s.ersteNutzung || b.datum < s.ersteNutzung) s.ersteNutzung = b.datum;
    if (!s.letzteNutzung || b.datum > s.letzteNutzung) s.letzteNutzung = b.datum;
  }
  return s;
}

/** Shop-weite Rabattcodes (Newsletter, Sales, Gewerbe, Kulanz) — keine Influencer-Vorschläge. */
const ALLGEMEIN = /^(WELCOME|EARLY|GEWERBE|RABATT|KULANZ|VIP|BENUTZERDEFINIERT|BLACK|BF|CYBER|XMAS|SALE|NEWSLETTER|HPOP)/;

/** Benutzte Codes, die keinem Influencer zugeordnet sind (Vorschläge zum Anlegen). Allgemeine Shop-Codes sind ausgeblendet. */
export function freieCodes(bestellungen: CodeBestellung[], vergeben: Set<string>, seit: string): { code: string; bestellungen: number; umsatz: number }[] {
  const m = new Map<string, { bestellungen: number; umsatz: number }>();
  for (const b of bestellungen) {
    if (b.datum < seit) continue;
    for (const c of b.codes) {
      if (vergeben.has(c) || ALLGEMEIN.test(c)) continue;
      const v = m.get(c) ?? { bestellungen: 0, umsatz: 0 };
      v.bestellungen++;
      v.umsatz += b.summe;
      m.set(c, v);
    }
  }
  return [...m].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.bestellungen - a.bestellungen);
}

export function verschiebe(iso: string, tage: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

export interface PostingEffekt {
  posting: Posting;
  influencer: Influencer | undefined;
  /** Umsatz am Posting-Tag + 2 Folgetage (nur abgeschlossene Tage). */
  fenster: number;
  /** Gleiche Wochentage der 4 Wochen davor, gemittelt. */
  basis: number;
  /** fenster/basis − 1; null = zu wenig Daten (Posting jünger als 1 Tag oder Basis fehlt). */
  uplift: number | null;
  tageImFenster: number;
  codeBestellungen: number;
  codeUmsatz: number;
  /** Anderes Posting im ±2-Tage-Fenster → Effekte nicht trennbar. */
  ueberlagert: boolean;
}

export const FENSTER_TAGE = 3;

/**
 * Schätzung, kein Beweis: Vergleich des Umsatzes am Posting-Tag + 2 Folgetagen mit denselben
 * Wochentagen der 4 Wochen davor. Überlagerungen (andere Postings, Sales) verfälschen das —
 * deshalb wird "überlagert" markiert und die Code-Bestellungen (harte Zahl) daneben gezeigt.
 */
export function postingEffekte(
  postings: Posting[],
  influencer: Influencer[],
  tagesUmsatz: Map<string, number>,
  bestellungen: CodeBestellung[],
  heute: string,
): PostingEffekt[] {
  const infl = new Map(influencer.map((i) => [i.id, i]));
  return postings.map((p) => {
    const i = infl.get(p.influencer_id);
    let fenster = 0, basis = 0, tageImFenster = 0, basisTage = 0;
    for (let k = 0; k < FENSTER_TAGE; k++) {
      const tag = verschiebe(p.datum, k);
      if (tag >= heute || !tagesUmsatz.has(tag)) continue;
      const vergleich = [7, 14, 21, 28].map((w) => tagesUmsatz.get(verschiebe(tag, -w))).filter((v): v is number => v !== undefined);
      if (!vergleich.length) continue;
      fenster += tagesUmsatz.get(tag)!;
      basis += vergleich.reduce((a, b) => a + b, 0) / vergleich.length;
      tageImFenster++;
      basisTage += vergleich.length;
    }
    const code = i?.rabattcode ? normCode(i.rabattcode) : null;
    const ende = verschiebe(p.datum, FENSTER_TAGE - 1);
    let codeBestellungen = 0, codeUmsatz = 0;
    if (code) {
      for (const b of bestellungen) {
        if (b.datum >= p.datum && b.datum <= ende && b.codes.includes(code)) {
          codeBestellungen++;
          codeUmsatz += b.summe;
        }
      }
    }
    const ueberlagert = postings.some((q) => q.id !== p.id && q.influencer_id !== p.influencer_id && Math.abs(Date.parse(q.datum) - Date.parse(p.datum)) <= 2 * 86400000);
    return {
      posting: p,
      influencer: i,
      fenster,
      basis,
      uplift: tageImFenster > 0 && basis > 0 && basisTage >= tageImFenster * 2 ? fenster / basis - 1 : null,
      tageImFenster,
      codeBestellungen,
      codeUmsatz,
      ueberlagert,
    };
  });
}

export async function ladeTagesUmsatzMap(tage: number): Promise<Map<string, number>> {
  const t = await ladeTagesUmsatz(tage);
  return new Map(t.map((x) => [x.datum, x.umsatz]));
}
