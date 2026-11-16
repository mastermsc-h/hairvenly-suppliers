// Newsletter-Abonnenten aus Shopify (E-Mail-Marketing-Einwilligung der Kundinnen) — server-only.
//
// Bestände: Shopify-Kundensegmente (email_subscription_status = …) liefern exakte Zahlen.
// Bewegungen: jede Kundin trägt das Datum ihrer letzten Einwilligungsänderung (consentUpdatedAt).
//   neu            = heute SUBSCRIBED,   letzte Änderung an Tag X → Anmeldung (bestätigt) an X
//   neu_ausstehend = heute PENDING,      … → Anmeldung an X, Bestätigungslink noch nicht geklickt
//   abmeldungen    = heute UNSUBSCRIBED, … → Abmeldung an X
// Täglicher Lauf: nur Kundinnen, die seit 3 Tagen geändert wurden (eine Einwilligung ändert
// updatedAt mit) → die letzten Tage exakt. Voller Lauf (~30 s, 20.000 Kundinnen): Verlauf.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { shopifyGraphQL } from "@/lib/shopify";
import type { NewsletterDaten, NewsletterZeitraum } from "@/lib/cockpit/typen";

const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
const plusTage = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface NewsletterTag {
  tag: string;
  abonniert: number | null;
  ausstehend: number | null;
  abgemeldet: number | null;
  rekonstruiert: boolean;
  neu: number;
  neu_ausstehend: number;
  abmeldungen: number;
}

async function segmentAnzahl(status: string): Promise<number> {
  const r = await shopifyGraphQL<{ customerSegmentMembers: { totalCount: number } }>(
    `{ customerSegmentMembers(first: 1, query: "email_subscription_status = '${status}'") { totalCount } }`,
  );
  const n = r.data?.customerSegmentMembers?.totalCount;
  if (typeof n !== "number") throw new Error(`Shopify: keine Anzahl für ${status}`);
  return n;
}

export async function holeBestand(): Promise<{ abonniert: number; ausstehend: number; abgemeldet: number }> {
  const [abonniert, ausstehend, abgemeldet] = await Promise.all([segmentAnzahl("SUBSCRIBED"), segmentAnzahl("PENDING"), segmentAnzahl("UNSUBSCRIBED")]);
  return { abonniert, ausstehend, abgemeldet };
}

/** Bewegungen je Tag aus der letzten Einwilligungsänderung; `seit` = nur Kundinnen, die seitdem geändert wurden. */
async function holeBewegungen(seit: string | null, deadlineMs: number): Promise<{ tage: Map<string, { neu: number; neu_ausstehend: number; abmeldungen: number }>; vollstaendig: boolean }> {
  type Res = { customers: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: { emailMarketingConsent: { marketingState: string; consentUpdatedAt: string | null } | null } }> } };
  const tage = new Map<string, { neu: number; neu_ausstehend: number; abmeldungen: number }>();
  let after: string | null = null;
  for (let seite = 0; seite < 400; seite++) {
    if (Date.now() > deadlineMs) return { tage, vollstaendig: false };
    const res: { data?: Res } = await shopifyGraphQL<Res>(
      `query($q: String, $a: String) { customers(first: 250, after: $a, query: $q) { pageInfo { hasNextPage endCursor } edges { node { emailMarketingConsent { marketingState consentUpdatedAt } } } } }`,
      { q: seit ? `updated_at:>='${seit}'` : null, a: after },
    );
    const c: Res["customers"] | undefined = res.data?.customers;
    if (!c) throw new Error("Shopify: keine Kundendaten");
    for (const { node } of c.edges) {
      const k = node.emailMarketingConsent;
      if (!k?.consentUpdatedAt) continue;
      const tag = berlin.format(new Date(k.consentUpdatedAt));
      const e = tage.get(tag) ?? { neu: 0, neu_ausstehend: 0, abmeldungen: 0 };
      if (k.marketingState === "SUBSCRIBED") e.neu++;
      else if (k.marketingState === "PENDING") e.neu_ausstehend++;
      else if (k.marketingState === "UNSUBSCRIBED") e.abmeldungen++;
      else continue;
      tage.set(tag, e);
    }
    if (!c.pageInfo.hasNextPage) return { tage, vollstaendig: true };
    after = c.pageInfo.endCursor;
  }
  return { tage, vollstaendig: false };
}

/** Bestände für Tage ohne Messung vom nächsten gemessenen Tag rückwärts rechnen. */
function rekonstruiere(zeilen: NewsletterTag[]): NewsletterTag[] {
  const neuesteZuerst = [...zeilen].sort((a, b) => b.tag.localeCompare(a.tag));
  let anker: NewsletterTag | null = null;
  for (const z of neuesteZuerst) {
    if (!z.rekonstruiert && z.abonniert != null) { anker = z; continue; }
    if (!anker) continue;
    // Stand am Ende von z = Stand am Ende des Folgetags − dessen Anmeldungen + dessen Abmeldungen
    z.abonniert = (anker.abonniert ?? 0) - anker.neu + anker.abmeldungen;
    z.abgemeldet = (anker.abgemeldet ?? 0) - anker.abmeldungen;
    z.ausstehend = null; // unbestätigte Anmeldungen wandern hin und her – rückwärts nicht sinnvoll
    z.rekonstruiert = true;
    anker = z;
  }
  return zeilen;
}

export async function syncNewsletter(
  sb: SupabaseClient = createServiceClient(),
  opts: { voll?: boolean; deadlineMs?: number } = {},
): Promise<{ tage: number; bestand: { abonniert: number; ausstehend: number; abgemeldet: number }; vollstaendig: boolean }> {
  const heute = berlin.format(new Date());
  const deadline = opts.deadlineMs ?? Date.now() + 45_000;
  const fenster = 3; // Tage, die der tägliche Lauf neu zählt
  const seit = opts.voll ? null : plusTage(heute, -fenster);
  const [bestand, bew] = await Promise.all([holeBestand(), holeBewegungen(seit, deadline)]);
  if (!bew.vollstaendig) throw new Error("Zeitlimit beim Kundenabruf – nichts gespeichert");

  const { data: alt } = await sb.from("newsletter_tag").select("*").gte("tag", "2000-01-01");
  const map = new Map<string, NewsletterTag>(((alt ?? []) as NewsletterTag[]).map((z) => [String(z.tag).slice(0, 10), { ...z, tag: String(z.tag).slice(0, 10) }]));
  const leer = (tag: string): NewsletterTag => ({ tag, abonniert: null, ausstehend: null, abgemeldet: null, rekonstruiert: true, neu: 0, neu_ausstehend: 0, abmeldungen: 0 });

  // Bewegungen: beim vollen Lauf alle Tage, sonst nur das Fenster (ältere Tage bleiben, wie sie sind)
  const ab = opts.voll ? null : seit!;
  if (opts.voll) for (const z of map.values()) { z.neu = 0; z.neu_ausstehend = 0; z.abmeldungen = 0; }
  else for (const z of map.values()) if (z.tag >= ab!) { z.neu = 0; z.neu_ausstehend = 0; z.abmeldungen = 0; }
  for (const [tag, b] of bew.tage) {
    if (ab && tag < ab) continue;
    const z = map.get(tag) ?? leer(tag);
    Object.assign(z, b);
    map.set(tag, z);
  }
  // Lückenlose Tagesreihe ab dem ersten Tag (sonst fehlen Tage ohne Bewegung im Diagramm)
  const tage = [...map.keys()].sort();
  if (tage.length) for (let t = tage[0]; t <= heute; t = plusTage(t, 1)) if (!map.has(t)) map.set(t, leer(t));
  // Heutiger Bestand ist gemessen
  const h = map.get(heute) ?? leer(heute);
  map.set(heute, { ...h, ...bestand, rekonstruiert: false });

  const zeilen = rekonstruiere([...map.values()]);
  const stand = new Date().toISOString();
  for (let i = 0; i < zeilen.length; i += 500) {
    const { error } = await sb.from("newsletter_tag").upsert(zeilen.slice(i, i + 500).map((z) => ({ ...z, stand })), { onConflict: "tag" });
    if (error) throw new Error(error.message);
  }
  return { tage: zeilen.length, bestand, vollstaendig: true };
}

export async function ladeNewsletterTage(sb: SupabaseClient = createServiceClient(), seit?: string): Promise<NewsletterTag[]> {
  const out: NewsletterTag[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    let q = sb.from("newsletter_tag").select("tag, abonniert, ausstehend, abgemeldet, rekonstruiert, neu, neu_ausstehend, abmeldungen").order("tag").range(from, from + 999);
    if (seit) q = q.gte("tag", seit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as NewsletterTag[]).map((z) => ({ ...z, tag: String(z.tag).slice(0, 10) })));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Bekannte Ereignisse, die die Anmeldungen erklären (Angabe des Users). */
export const NEWSLETTER_EREIGNISSE: Array<{ von: string; bis: string; text: string }> = [
  // User 16.11.2026: Pop-up mit Gewinnspielrad, im April 2026 entfernt (Beginn laut Daten Nov 2025)
  { von: "2025-11", bis: "2026-04", text: "Glücksrad-Pop-up" },
];

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const zahl = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n));

/** Auswertung für Seite und Startbildschirm. */
export function werteNewsletterAus(tage: NewsletterTag[]): NewsletterDaten {
  const heute = berlin.format(new Date());
  const gemessen = [...tage].reverse().find((t) => !t.rekonstruiert && t.abonniert != null) ?? null;
  const summe = (von: string, bis: string) => {
    const l = tage.filter((t) => t.tag > von && t.tag <= bis);
    return { neu: l.reduce((s, t) => s + t.neu, 0), ausstehend: l.reduce((s, t) => s + t.neu_ausstehend, 0), abmeldungen: l.reduce((s, t) => s + t.abmeldungen, 0) };
  };
  const zeitraum = (n: number): NewsletterZeitraum => {
    const a = summe(plusTage(heute, -n), heute);
    const v = summe(plusTage(heute, -2 * n), plusTage(heute, -n));
    return { ...a, vorNeu: v.neu, vorAusstehend: v.ausstehend, vorAbmeldungen: v.abmeldungen };
  };
  const d7 = zeitraum(7);
  const d30 = zeitraum(30);
  const anm30 = d30.neu + d30.ausstehend;

  // Monate (letzte 18), Stand am Monatsende
  const proMonat = new Map<string, { neu: number; ausstehend: number; abmeldungen: number; ende: number | null }>();
  for (const t of tage) {
    const m = t.tag.slice(0, 7);
    const e = proMonat.get(m) ?? { neu: 0, ausstehend: 0, abmeldungen: 0, ende: null };
    e.neu += t.neu; e.ausstehend += t.neu_ausstehend; e.abmeldungen += t.abmeldungen;
    if (t.abonniert != null) e.ende = t.abonniert;
    proMonat.set(m, e);
  }
  const monate = [...proMonat.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-18).map(([monat, e]) => ({ monat, ...e }));

  // Einordnung: volle Monate (ohne laufenden)
  const voll = monate.filter((m) => m.monat < heute.slice(0, 7));
  const letzte3 = voll.slice(-3), davor3 = voll.slice(-6, -3);
  const schnitt = (l: typeof voll) => (l.length ? l.reduce((s, m) => s + m.neu, 0) / l.length : 0);
  const hinweise: NewsletterDaten["hinweise"] = [];
  const spitze = [...voll].sort((a, b) => b.neu - a.neu)[0];
  if (davor3.length === 3 && schnitt(davor3) > 0 && schnitt(letzte3) < schnitt(davor3) * 0.5) {
    hinweise.push({ ton: "warn", text: `Anmeldungen eingebrochen: Ø ${zahl(schnitt(letzte3))} pro Monat in den letzten 3 Monaten gegen Ø ${zahl(schnitt(davor3))} davor.` });
  }
  // Bekannte Ereignisse: Monate mit und ohne vergleichen (laufender Monat ausgenommen)
  for (const ev of NEWSLETTER_EREIGNISSE) {
    const mit = voll.filter((m) => m.monat > ev.von && m.monat < ev.bis); // volle Monate mittendrin
    const ohne = voll.filter((m) => m.monat > ev.bis);
    if (mit.length && ohne.length && schnitt(mit) > 2 * Math.max(schnitt(ohne), 1)) {
      const [y, m] = ev.bis.split("-");
      hinweise.push({ ton: "info", text: `Mit dem ${ev.text} kamen Ø ${zahl(schnitt(mit))} neue Abonnenten pro Monat, seit es im ${MONATE[Number(m) - 1]} ${y} entfernt wurde Ø ${zahl(schnitt(ohne))} – rund ${zahl(schnitt(mit) - schnitt(ohne))} pro Monat weniger.` });
    }
  }
  if (!NEWSLETTER_EREIGNISSE.length && spitze && spitze.neu > 3 * Math.max(schnitt(letzte3), 1)) {
    const [y, m] = spitze.monat.split("-");
    hinweise.push({ ton: "info", text: `Stärkster Monat war ${MONATE[Number(m) - 1]} ${y} mit ${zahl(spitze.neu)} neuen Abonnenten – was lief da anders (Pop-up, Gewinnspiel, Rabatt)?` });
  }
  if (anm30 >= 20 && d30.ausstehend > d30.neu) {
    hinweise.push({ ton: "warn", text: `${zahl(d30.ausstehend)} der ${zahl(anm30)} Anmeldungen der letzten 30 Tage sind noch unbestätigt. Kommt die Bestätigungs-E-Mail an (Spam)?` });
  }
  if (d30.abmeldungen > 0 && d30.abmeldungen > d30.neu * 0.5) {
    hinweise.push({ ton: "warn", text: `Viele Abmeldungen: ${zahl(d30.abmeldungen)} in 30 Tagen bei ${zahl(d30.neu)} neuen.` });
  }
  if (!hinweise.length) hinweise.push({ ton: "gut", text: "Keine Auffälligkeiten bei An- und Abmeldungen." });

  const netto30 = d30.neu - d30.abmeldungen;
  const schlagzeile = d30.ausstehend > d30.neu && anm30 >= 20
    ? `${zahl(d30.ausstehend)} Anmeldungen warten auf Bestätigung`
    : netto30 > 0 ? `Leserschaft wächst um ${zahl(netto30)} in 30 Tagen` : netto30 < 0 ? `Leserschaft schrumpft um ${zahl(-netto30)}` : "Leserschaft stabil";
  const unterzeile = gemessen
    ? `${zahl(gemessen.abonniert ?? 0)} Abonnentinnen lesen mit · ${zahl(d7.neu)} neue diese Woche · ${zahl(d30.abmeldungen)} Abmeldungen im Monat`
    : "Noch kein gemessener Bestand";
  const vor30 = tage.find((t) => t.tag === plusTage(heute, -30));

  return {
    bestand: gemessen ? { abonniert: gemessen.abonniert ?? 0, ausstehend: gemessen.ausstehend ?? 0, abgemeldet: gemessen.abgemeldet ?? 0, tag: gemessen.tag } : null,
    d7, d30,
    bestaetigt30: anm30 ? Math.round((d30.neu / anm30) * 1000) / 10 : null,
    abonniertVor30: vor30?.abonniert ?? null,
    monate,
    tage: tage.slice(-120).map((t) => ({ tag: t.tag, neu: t.neu, ausstehend: t.neu_ausstehend, abmeldungen: t.abmeldungen, abonniert: t.abonniert })),
    hinweise, schlagzeile, unterzeile,
  };
}

export async function ladeNewsletter(sb: SupabaseClient = createServiceClient()): Promise<NewsletterDaten> {
  return werteNewsletterAus(await ladeNewsletterTage(sb, plusTage(berlin.format(new Date()), -600)));
}
