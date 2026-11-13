// Lesender Zugriff auf zwei externe Supabase-Projekte der Firma:
//  - HALO (Marketing-Team-Aufgaben, halo.hairvenly.de)      → RPC jarvis_halo
//  - marketing-analytics (marketing.hairvenly.de)           → RPC jarvis_marketing
// Beide Funktionen sind SECURITY DEFINER, antworten nur mit dem geheimen Schlüssel
// (HALO_JARVIS_KEY / MKT_JARVIS_KEY) und liefern nur Kennzahlen bzw. Aufgaben.
// SQL dazu: supabase/external/*.sql. Nur serverseitig verwenden.
import "server-only";

// ── Typen ────────────────────────────────────────────────────────────
export type HaloSchritt = { titel: string; geplant: string | null; minuten: number | null; von: string | null };
export type HaloAufgabe = {
  id: number;
  nr: number | null;
  titel: string;
  bereich: string | null;
  person: string | null;
  person2: string | null;
  beteiligt: string[] | null;
  prio: "hoch" | "mittel" | "niedrig" | string | null;
  status: "offen" | "erledigt" | "abgebrochen" | string;
  faellig: string | null;
  angelegt: string | null;
  kampagne: string | null;
  zuletzt_geaendert: string;
  schritte_gesamt: number;
  schritte_erledigt: number;
  offene_schritte: HaloSchritt[];
};
export type HaloKampagne = { id: string; n: string; st: string; pr: string; von: string | null; bis: string | null; who: string | null };
export type HaloDaten = { stand: string; aufgaben: HaloAufgabe[]; kampagnen: HaloKampagne[] };

export type MktTag = { datum: string; bestellungen: number; umsatz: number; meta_kosten: number; google_kosten: number; such_klicks: number };
export type MktDaten = {
  stand: string;
  zeitraum: { von: string; bis: string; tage: number; vorher_von: string; vorher_bis: string };
  aktualitaet: Record<string, string | null>;
  umsatz: {
    bestellungen: number; brutto: number; rabatte: number; erstattungen: number;
    vorher_bestellungen: number; vorher_brutto: number; vorher_erstattungen: number;
  };
  werbung: {
    meta_kosten: number; meta_kosten_vorher: number; google_kosten: number; google_kosten_vorher: number;
    meta_kampagnen: { kampagne: string; kosten: number; klicks: number; impressionen: number; reichweite: number }[];
    google_kampagnen: { kampagne: string; kosten: number; klicks: number; impressionen: number; conversions: number; conv_wert: number }[];
  };
  tage: MktTag[];
  quellen: { quelle: string; bestellungen: number; umsatz: number }[];
  besucher: {
    funnel: { period_start: string; period_end: string; sessions: number; cart: number; checkout: number; purchased: number }[];
    kanaele: { source: string; sessions: number; checkouts: number; period_start: string; period_end: string }[];
    top_seiten: { path: string; sessions: number; checkout_sessions: number; period_start: string; period_end: string }[];
  };
  suche: {
    klicks: number; impressionen: number; klicks_vorher: number; impressionen_vorher: number; position: number | null;
    top_suchbegriffe: { begriff: string; klicks: number; impressionen: number; position: number }[];
    top_seiten: { seite: string; klicks: number; impressionen: number }[];
    schnelle_erfolge: { query: string; position: number; page: string; clicks: number; impressions: number }[];
    aufsteiger: { query: string; old_position: number; new_position: number; improvement: number }[];
  };
  instagram: { reichweite: number; profilaufrufe: number; website_klicks: number; follower: number | null } | null;
  seo_offen: {
    anzahl: Record<string, number> | null;
    punkte: { schwere: string; kategorie: string; problem: string; massnahme: string; url: string | null }[];
  };
};

// ── Abruf ────────────────────────────────────────────────────────────
async function rpc<T>(prefix: "HALO" | "MKT", fn: string, body: Record<string, unknown>): Promise<T> {
  const url = process.env[`${prefix}_SUPABASE_URL`];
  const anon = process.env[`${prefix}_SUPABASE_ANON_KEY`];
  const key = process.env[`${prefix}_JARVIS_KEY`];
  if (!url || !anon || !key) throw new Error(`${prefix}: Zugangsdaten fehlen (${prefix}_SUPABASE_URL / _ANON_KEY / _JARVIS_KEY)`);
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_key: key, ...body }),
    next: { revalidate: 300 }, // 5 Min Cache — Quellen aktualisieren sich höchstens stündlich
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`${prefix} ${fn}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

// Ein Wiederholversuch bei Statement-Timeout (anon hat 3 s; kalter DB-Cache kann knapp werden).
async function mitWiederholung<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof Error && /57014|statement timeout/.test(e.message)) return f();
    throw e;
  }
}

export function ladeHalo(): Promise<HaloDaten> {
  return mitWiederholung(() => rpc<HaloDaten>("HALO", "jarvis_halo", {}));
}

// Zwei Teile parallel (Umsatz/Werbung/Besucher + Google-Suche), damit jeder Aufruf
// sicher unter dem anon-Timeout bleibt.
export async function ladeMarketing(tage = 28): Promise<MktDaten> {
  const [a, b] = await Promise.all([
    mitWiederholung(() => rpc<MktDaten>("MKT", "jarvis_marketing", { p_days: tage, p_teil: "umsatz" })),
    mitWiederholung(() => rpc<Pick<MktDaten, "suche">>("MKT", "jarvis_marketing", { p_days: tage, p_teil: "suche" })),
  ]);
  return { ...a, suche: b.suche };
}

/** Nur der Tagesverlauf (Umsatz/Werbekosten je Tag), z. B. für Influencer-Effekte. */
// Schlanke RPC jarvis_marketing_tage (nur Tagesreihe, ~0,3 s auch für 365 Tage).
export async function ladeTagesUmsatz(tage: number): Promise<Omit<MktTag, "such_klicks">[]> {
  const a = await mitWiederholung(() => rpc<{ tage: Omit<MktTag, "such_klicks">[] }>("MKT", "jarvis_marketing_tage", { p_days: tage }));
  return a.tage;
}

// ── Dringlichkeit ────────────────────────────────────────────────────
// Ein offener Schritt/eine Aufgabe ist "dringend", wenn sie überfällig ist,
// in den nächsten 2 Tagen fällig/geplant ist, oder Prio hoch hat und in 7 Tagen fällig ist.
export type DringendEintrag = {
  aufgabeId: number;
  aufgabe: string;
  schritt: string | null;
  person: string | null;
  bereich: string | null;
  prio: string | null;
  datum: string | null; // fällig bzw. geplant
  art: "ueberfaellig" | "heute" | "bald" | "prio";
  tageBis: number | null;
};

function tageBis(iso: string | null, heute: string): number | null {
  if (!iso) return null;
  return Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) - Date.parse(`${heute}T12:00:00Z`)) / 86400000);
}

export function heuteBerlin(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

export function dringendeAufgaben(d: HaloDaten, heute = heuteBerlin()): DringendEintrag[] {
  const out: DringendEintrag[] = [];
  const art = (n: number | null, prio: string | null): DringendEintrag["art"] | null => {
    if (n === null) return null;
    if (n < 0) return "ueberfaellig";
    if (n === 0) return "heute";
    if (n <= 2) return "bald";
    if (prio === "hoch" && n <= 7) return "prio";
    return null;
  };
  for (const a of d.aufgaben) {
    if (a.status !== "offen") continue;
    const nA = tageBis(a.faellig, heute);
    const artA = art(nA, a.prio);
    if (artA) {
      out.push({ aufgabeId: a.id, aufgabe: a.titel, schritt: null, person: a.person, bereich: a.bereich, prio: a.prio, datum: a.faellig, art: artA, tageBis: nA });
    }
    for (const s of a.offene_schritte) {
      const n = tageBis(s.geplant, heute);
      const artS = art(n, a.prio);
      if (!artS) continue;
      out.push({ aufgabeId: a.id, aufgabe: a.titel, schritt: s.titel, person: s.von ?? a.person, bereich: a.bereich, prio: a.prio, datum: s.geplant, art: artS, tageBis: n });
    }
  }
  const rang = { ueberfaellig: 0, heute: 1, bald: 2, prio: 3 } as const;
  const prioRang = (p: string | null) => (p === "hoch" ? 0 : p === "mittel" ? 1 : 2);
  return out.sort((x, y) => rang[x.art] - rang[y.art] || (x.tageBis ?? 99) - (y.tageBis ?? 99) || prioRang(x.prio) - prioRang(y.prio));
}

export const PERSONEN: Record<string, string> = { mariam: "Mariam", mehmet: "Mehmet", thao: "Thao", alina: "Alina" };
export const personName = (p: string | null) => (p ? PERSONEN[p] ?? p : "—");
