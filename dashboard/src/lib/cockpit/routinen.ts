// Routinen für den Startbildschirm (server-only): Fälligkeit aus Intervall + letzter Bestellung,
// bzw. aus der Reichweite ausgewählter Produkte (Bestand live aus Shopify, Verkauf 60 Tage).
import { createServiceClient } from "@/lib/supabase/server";
import { shopifyGraphQL } from "@/lib/shopify";
import type { Routine, RoutineProdukt } from "./typen";

const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
const plusTage = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const tageZwischen = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const FARBEN = ["#7c5cff", "#f0508f", "#0fb5ba", "#ef9a0c", "#2f9bff", "#12b76a", "#e85d3f"];

type Zeile = {
  id: string; titel: string; art: "intervall" | "lager"; intervall_tage: number | null; quelle: string | null;
  lieferzeit_tage: number | null; puffer_tage: number; produkte: Array<{ handle: string; titel: string }> | null;
  letzte_erledigung: string | null; erledigt_von: string | null; notiz: string; farbe: string | null; sort: number;
};

/** Bestand je Produkt (Summe aller Varianten) live aus Shopify. */
async function bestaende(handles: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < handles.length; i += 40) {
    const teil = handles.slice(i, i + 40);
    const q = teil.map((h) => `handle:${h}`).join(" OR ");
    const r = await shopifyGraphQL<{ products: { edges: Array<{ node: { handle: string; totalInventory: number } }> } }>(
      `query($q: String!) { products(first: 50, query: $q) { edges { node { handle totalInventory } } } }`, { q },
    );
    for (const e of r.data?.products.edges ?? []) out.set(e.node.handle, e.node.totalInventory);
  }
  return out;
}

export async function ladeRoutinen(): Promise<Routine[]> {
  const sb = createServiceClient();
  const heute = berlin.format(new Date());
  const [{ data: rows, error }, { data: orders }] = await Promise.all([
    sb.from("cockpit_routinen").select("*").order("sort").order("created_at"),
    sb.from("orders").select("order_date, created_at, status, suppliers(name)").not("status", "in", "(draft,cancelled,hidden)").order("order_date", { ascending: false }).limit(300),
  ]);
  if (error) throw new Error(error.message);
  const zeilen = (rows ?? []) as Zeile[];

  // Lager-Routinen: Bestand + Verkauf der ausgewählten Produkte
  const handles = [...new Set(zeilen.filter((z) => z.art === "lager").flatMap((z) => (z.produkte ?? []).map((p) => p.handle)))];
  const bestand = handles.length ? await bestaende(handles).catch(() => new Map<string, number>()) : new Map<string, number>();
  const verkauf = new Map<string, number>();
  if (handles.length) {
    for (let from = 0; from < 20000; from += 1000) {
      const { data } = await sb.from("shopify_variant_daily_sales").select("handle, units").in("handle", handles).gte("day", plusTage(heute, -60)).range(from, from + 999);
      for (const r of (data ?? []) as Array<{ handle: string; units: number }>) verkauf.set(r.handle, (verkauf.get(r.handle) ?? 0) + Number(r.units));
      if (!data || data.length < 1000) break;
    }
  }

  const letzteBestellung = (quelle: string | null) => {
    if (!quelle) return null;
    const q = quelle.toLowerCase();
    for (const o of (orders ?? []) as Array<{ order_date: string | null; created_at: string; suppliers: { name: string } | { name: string }[] | null }>) {
      const s = Array.isArray(o.suppliers) ? o.suppliers[0] : o.suppliers;
      if (s?.name?.toLowerCase().includes(q)) return (o.order_date ?? o.created_at).slice(0, 10);
    }
    return null;
  };

  return zeilen.map((z, i): Routine => {
    const farbe = z.farbe ?? FARBEN[i % FARBEN.length];
    const basis = { id: z.id, titel: z.titel, art: z.art, intervallTage: z.intervall_tage, quelle: z.quelle, lieferzeitTage: z.lieferzeit_tage, pufferTage: z.puffer_tage, notiz: z.notiz, farbe, letzteErledigung: z.letzte_erledigung ? String(z.letzte_erledigung).slice(0, 10) : null, erledigtVon: z.erledigt_von };
    if (z.art === "lager") {
      const lz = z.lieferzeit_tage ?? 60;
      const grenze = lz + z.puffer_tage;
      const produkte: RoutineProdukt[] = (z.produkte ?? []).map((p) => {
        const b = bestand.has(p.handle) ? bestand.get(p.handle)! : null;
        const proTag = verkauf.has(p.handle) ? (verkauf.get(p.handle)! / 60) : 0;
        return { handle: p.handle, titel: p.titel, bestand: b, proTag: Math.round(proTag * 100) / 100, reichtTage: b != null && proTag > 0 ? Math.max(0, Math.round(b / proTag)) : null };
      }).sort((a, b) => (a.reichtTage ?? 99999) - (b.reichtTage ?? 99999));
      const knappste = produkte.find((p) => p.reichtTage != null) ?? null;
      // Nach "Erledigt" (bestellt) ruht die Routine, bis die Ware da sein müsste
      const ruhtBis = basis.letzteErledigung ? plusTage(basis.letzteErledigung, lz) : null;
      if (ruhtBis && ruhtBis > heute) {
        return { ...basis, letzteBestellung: null, faellig: ruhtBis, tageBis: tageZwischen(heute, ruhtBis), fortschritt: tageZwischen(basis.letzteErledigung!, heute) / lz, status: "ruht", produkte };
      }
      if (!knappste) return { ...basis, letzteBestellung: null, faellig: null, tageBis: null, fortschritt: 0, status: "ok", produkte };
      const tageBis = knappste.reichtTage! - grenze; // Tage, bis bestellt werden muss
      return {
        ...basis, letzteBestellung: null, faellig: plusTage(heute, tageBis), tageBis,
        fortschritt: Math.min(1.5, grenze / Math.max(knappste.reichtTage!, 1)),
        status: tageBis < 0 ? "ueberfaellig" : tageBis === 0 ? "faellig" : tageBis <= 14 ? "bald" : "ok", produkte,
      };
    }
    const iv = z.intervall_tage ?? 30;
    const lb = letzteBestellung(z.quelle);
    const letzte = [basis.letzteErledigung, lb].filter((x): x is string => !!x).sort().pop() ?? null;
    if (!letzte) return { ...basis, letzteBestellung: lb, faellig: heute, tageBis: 0, fortschritt: 1, status: "faellig", produkte: [] };
    const faellig = plusTage(letzte, iv);
    const tageBis = tageZwischen(heute, faellig);
    return {
      ...basis, letzteBestellung: lb, faellig, tageBis,
      fortschritt: Math.min(1.5, tageZwischen(letzte, heute) / iv),
      status: tageBis < 0 ? "ueberfaellig" : tageBis === 0 ? "faellig" : tageBis <= Math.max(2, Math.round(iv * 0.2)) ? "bald" : "ok",
      produkte: [],
    };
  });
}

/** Produktsuche für die Auswahl einer Lager-Routine. */
export async function sucheProdukte(text: string): Promise<Array<{ handle: string; titel: string; bestand: number }>> {
  const t = text.replace(/["\\*]/g, " ").trim();
  if (t.length < 2) return [];
  const r = await shopifyGraphQL<{ products: { edges: Array<{ node: { handle: string; title: string; totalInventory: number } }> } }>(
    `query($q: String!) { products(first: 15, query: $q) { edges { node { handle title totalInventory } } } }`, { q: `title:*${t}* status:active` },
  );
  return (r.data?.products.edges ?? []).map((e) => ({ handle: e.node.handle, titel: e.node.title.split(" – ")[0].slice(0, 80), bestand: e.node.totalInventory }));
}
