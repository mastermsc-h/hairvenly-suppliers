// Daten für die verspielten Startbildschirm-Fenster (server-only): Hailey, Pflanze, Polaroids, Wetter.
import { createServiceClient } from "@/lib/supabase/server";
import { ladeRoutinen } from "./routinen";
import { ladeBericht } from "./auffaelligkeiten";
import { ladeChats, ladeUmsatz } from "./daten";

const berlinStunde = () => Number(new Intl.DateTimeFormat("de-DE", { hour: "numeric", hour12: false, timeZone: "Europe/Berlin" }).format(new Date()));
const wochentag = () => new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" }).format(new Date());

// ── Hailey ──────────────────────────────────────────────────────────────────
export type HaileyStimmung = "froh" | "normal" | "sturm";
export interface HaileyDaten { stimmung: HaileyStimmung; saetze: string[]; maskottchen: string }

const SPRUECHE = [
  "Wusstest du? Haare wachsen ungefähr 1 cm im Monat. Wir sind schneller. 💁‍♀️",
  "Kleine Schritte jeden Tag – große Mähne am Ende des Jahres.",
  "Kaffee getrunken? Dann los! ☕",
  "Gute Laune ist das beste Styling-Produkt.",
  "Ein Kopf hat rund 100.000 Haare. Und wir kümmern uns um jedes einzelne.",
  "Heute schon jemandem ein Kompliment gemacht?",
];

export async function ladeHailey(opts: { finanzen: boolean; chatbot: boolean; name: string; userId: string }): Promise<HaileyDaten> {
  const sicher = async <T,>(p: Promise<T>) => { try { return await p; } catch { return null; } };
  const [routinen, bericht, umsatz, chats, wahl] = await Promise.all([
    sicher(ladeRoutinen()),
    opts.finanzen ? sicher(ladeBericht()) : null,
    opts.finanzen ? sicher(ladeUmsatz()) : null,
    opts.chatbot ? sicher(ladeChats()) : null,
    sicher(Promise.resolve(createServiceClient().from("cockpit_layout").select("maskottchen").eq("user_id", opts.userId).maybeSingle()).then((r) => (r.data?.maskottchen as string | null) ?? null)),
  ]);
  const h = berlinStunde();
  const saetze: string[] = [];
  saetze.push(`${h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend"}, ${opts.name}! Schön, dass du da bist.`);
  for (const r of routinen ?? []) {
    if (r.status === "faellig") saetze.push(`Heute ist „${r.titel}“ dran – nicht vergessen!`);
    if (r.status === "ueberfaellig") saetze.push(`„${r.titel}“ ist seit ${-(r.tageBis ?? 0)} Tagen überfällig. Magst du das heute erledigen?`);
  }
  const hoch = bericht?.bericht?.punkte.filter((p) => p.schwere === "hoch").length ?? 0;
  if (hoch) saetze.push(`Im Gewitter-Fenster stehen ${hoch} ernste Punkte – ich halte den Schirm, du schaffst das! ☂️`);
  const tv = umsatz?.tageVergleich;
  let plus: number | null = null;
  if (tv && tv.letztes > 0) {
    plus = Math.round(((tv.dieses - tv.letztes) / tv.letztes) * 100);
    saetze.push(plus >= 0 ? `Der Monat läuft ${plus} % besser als letztes Jahr. Stark! 🎉` : `Der Monat liegt ${-plus} % unter Vorjahr – wir holen das auf!`);
  }
  if (chats && chats.wartend > 0) saetze.push(`${chats.wartend} Kundinnen warten im Chat auf eine Antwort.`);
  const tag = Math.floor(Date.now() / 86_400_000);
  saetze.push(SPRUECHE[tag % SPRUECHE.length]);
  const stimmung: HaileyStimmung = hoch >= 3 ? "sturm" : plus != null && plus >= 0 ? "froh" : "normal";
  return { stimmung, saetze, maskottchen: wahl ?? "hailey" };
}

// ── Pflanze ─────────────────────────────────────────────────────────────────
export interface PflanzeDaten { verhaeltnis: number | null; prozent: number | null; bisTag: number | null }
export async function ladePflanze(): Promise<PflanzeDaten> {
  const u = await ladeUmsatz();
  const tv = u.tageVergleich;
  if (!tv || tv.letztes <= 0) return { verhaeltnis: null, prozent: null, bisTag: null };
  const v = tv.dieses / tv.letztes;
  return { verhaeltnis: Math.round(v * 1000) / 1000, prozent: Math.round((v - 1) * 100), bisTag: tv.bisTag };
}

// ── Polaroids ───────────────────────────────────────────────────────────────
export interface Polaroid { id: string; url: string; titel: string; eigenes: boolean }
export async function ladePolaroids(userId: string): Promise<Polaroid[]> {
  const sb = createServiceClient();
  const { data } = await sb.from("cockpit_bilder").select("id, pfad, titel, owner_id").order("created_at", { ascending: false }).limit(40);
  const rows = (data ?? []) as Array<{ id: string; pfad: string; titel: string; owner_id: string | null }>;
  if (!rows.length) return [];
  const { data: signiert } = await sb.storage.from("cockpit-bilder").createSignedUrls(rows.map((r) => r.pfad), 60 * 60 * 6);
  const url = new Map((signiert ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.filter((r) => url.get(r.pfad)).map((r) => ({ id: r.id, url: url.get(r.pfad)!, titel: r.titel, eigenes: r.owner_id === userId }));
}

// ── Wetter (Bremen, Open-Meteo – frei, ohne Schlüssel) ──────────────────────
export interface WetterDaten {
  temperatur: number; code: number; tag: boolean; max: number; min: number;
  sonnenaufgang: string; sonnenuntergang: string; jetzt: string; regenWahrscheinlich: number;
  wochentag: string; satz: string;
}
export async function ladeWetter(): Promise<WetterDaten | null> {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=53.08&longitude=8.81&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&timezone=Europe%2FBerlin&forecast_days=1";
  const r = await fetch(url, { next: { revalidate: 1800 }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { current: { time: string; temperature_2m: number; weather_code: number; is_day: number }; daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; sunrise: string[]; sunset: string[]; precipitation_probability_max: number[] } };
  const routinen = await ladeRoutinen().catch(() => []);
  const dran = routinen.find((x) => x.status === "faellig" || x.status === "ueberfaellig");
  const wt = wochentag();
  const code = j.current.weather_code;
  const regen = code >= 51;
  const satz = dran
    ? `${regen ? "Regenwetter" : "Guter Tag"} für „${dran.titel}“.`
    : regen ? `Grauer ${wt} – perfekt für Büroarbeit.` : `Schöner ${wt} – nichts Dringendes in den Routinen.`;
  return {
    temperatur: Math.round(j.current.temperature_2m), code, tag: j.current.is_day === 1,
    max: Math.round(j.daily.temperature_2m_max[0]), min: Math.round(j.daily.temperature_2m_min[0]),
    sonnenaufgang: j.daily.sunrise[0], sonnenuntergang: j.daily.sunset[0], jetzt: j.current.time,
    regenWahrscheinlich: j.daily.precipitation_probability_max[0] ?? 0, wochentag: wt, satz,
  };
}
