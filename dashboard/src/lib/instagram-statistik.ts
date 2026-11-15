// Instagram-Statistik (@hairvenly.de) — server-only.
// Quelle: Instagram API with Instagram Login (graph.instagram.com), derselbe Token wie der Chatbot.
//
// Instagram liefert für vergangene Tage neue/verlorene Follower, Reichweite usw. (since/until je Tag),
// aber KEINEN Follower-Stand von früher. Deshalb speichert der tägliche Cron den Stand ab jetzt;
// ältere Tage werden vom nächsten gemessenen Tag aus über den Netto-Zuwachs zurückgerechnet.
// Die Tageswerte kommen mit 1–2 Tagen Verzug → jeder Lauf aktualisiert die letzten Tage erneut.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { getMetaToken } from "@/lib/messaging/meta-token";

const API = "https://graph.instagram.com/v23.0";
const berlinTag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });

export interface InstagramTag {
  tag: string;
  follower: number | null;
  rekonstruiert: boolean;
  neu: number | null;
  verloren: number | null;
  reichweite: number | null;
  aufrufe: number | null;
  profilaufrufe: number | null;
  website_klicks: number | null;
  interaktionen: number | null;
}

export interface InstagramDemografie {
  alter: Record<string, number>;
  geschlecht: Record<string, number>;
  land: Record<string, number>;
  stadt: Record<string, number>;
}

async function ig<T>(pfad: string, token: string): Promise<T> {
  const sep = pfad.includes("?") ? "&" : "?";
  const res = await fetch(`${API}/${pfad}${sep}access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (json.error) throw new Error(`Instagram: ${json.error.message}`);
  return json;
}

function plusTage(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Mitternacht deutscher Zeit eines Tages als Unix-Sekunden. */
function berlinMitternacht(tag: string): number {
  const mittag = new Date(`${tag}T12:00:00Z`);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" })
    .formatToParts(mittag).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const h = Number(off.match(/GMT([+-]\d+)/)?.[1] ?? 1);
  return Math.floor(Date.parse(`${tag}T00:00:00Z`) / 1000) - h * 3600;
}

type TotalRes = { data: Array<{ name: string; total_value?: { value?: number; breakdowns?: Array<{ results: Array<{ dimension_values: string[]; value: number }> }> } }> };

/** Kennzahlen eines vergangenen Tages (deutsche Zeit). */
async function holeTag(tag: string, token: string): Promise<Omit<InstagramTag, "follower" | "rekonstruiert">> {
  const since = berlinMitternacht(tag);
  const until = berlinMitternacht(plusTage(tag, 1));
  const [f, m] = await Promise.all([
    ig<TotalRes>(`me/insights?metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type&since=${since}&until=${until}`, token),
    ig<TotalRes>(`me/insights?metric=reach,views,profile_views,website_clicks,total_interactions&period=day&metric_type=total_value&since=${since}&until=${until}`, token),
  ]);
  const ergebnisse = f.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
  const wert = (typ: string) => ergebnisse.find((r) => r.dimension_values[0] === typ)?.value;
  // Fehlt die Aufschlüsselung, sind die Follower-Zahlen für den Tag noch nicht da (Verzug)
  const da = ergebnisse.length > 0;
  const kz = (name: string) => m.data?.find((x) => x.name === name)?.total_value?.value ?? null;
  return {
    tag,
    neu: da ? wert("FOLLOWER") ?? 0 : null,
    verloren: da ? wert("NON_FOLLOWER") ?? 0 : null,
    reichweite: kz("reach"),
    aufrufe: kz("views"),
    profilaufrufe: kz("profile_views"),
    website_klicks: kz("website_clicks"),
    interaktionen: kz("total_interactions"),
  };
}

async function holeDemografie(token: string): Promise<{ demografie: InstagramDemografie; online: Record<string, number> }> {
  const teil = async (breakdown: string) => {
    const r = await ig<TotalRes>(`me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&timeframe=this_month&breakdown=${breakdown}`, token);
    const out: Record<string, number> = {};
    for (const x of r.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []) out[x.dimension_values[0]] = x.value;
    return out;
  };
  const [alter, geschlecht, land, stadt, onl] = await Promise.all([
    teil("age"), teil("gender"), teil("country"), teil("city"),
    ig<{ data: Array<{ values: Array<{ value: Record<string, number> }> }> }>("me/insights?metric=online_followers&period=lifetime", token),
  ]);
  // Instagram liefert die Online-Stunden in Pazifik-Zeit → in deutsche Stunden umrechnen
  const werte = (onl.data?.[0]?.values ?? []).map((v) => v.value).filter((v) => v && Object.keys(v).length);
  const letzter = werte[werte.length - 1] ?? {};
  const versatz = stundenVersatzPazifikBerlin();
  const online: Record<string, number> = {};
  for (const [h, n] of Object.entries(letzter)) online[String((Number(h) + versatz + 24) % 24)] = n;
  return { demografie: { alter, geschlecht, land, stadt }, online };
}

function stundenVersatzPazifikBerlin(): number {
  const off = (tz: string) => {
    const v = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    return Number(v.match(/GMT([+-]\d+)/)?.[1] ?? 0);
  };
  return off("Europe/Berlin") - off("America/Los_Angeles");
}

/** Follower-Stand für Tage ohne Messung vom nächsten gemessenen Tag zurückrechnen. */
function rekonstruiere(zeilen: InstagramTag[]): InstagramTag[] {
  const neuesteZuerst = [...zeilen].sort((a, b) => b.tag.localeCompare(a.tag));
  let anker: InstagramTag | null = null;
  for (const z of neuesteZuerst) {
    if (!z.rekonstruiert && z.follower != null) { anker = z; continue; }
    if (!anker) continue;
    // Stand am Ende von z = Stand am Ende des Folgetags − Netto des Folgetags
    const netto = (anker.neu ?? 0) - (anker.verloren ?? 0);
    z.follower = (anker.follower ?? 0) - netto;
    z.rekonstruiert = true;
    anker = z;
  }
  return zeilen;
}

/**
 * Holt die letzten `tage` Tage (bis gestern) und speichert sie; dazu den heutigen Follower-Stand
 * (als Stand von gestern Abend) und Demografie. `tage` > 4 = Nachtragen der Vergangenheit.
 */
export async function syncInstagram(
  sb: SupabaseClient = createServiceClient(),
  opts: { tage?: number; deadlineMs?: number } = {},
): Promise<{ tage: number; follower: number; bisAm: string | null }> {
  const token = await getMetaToken();
  if (!token) throw new Error("Kein Instagram-Token");
  const tage = Math.max(1, Math.min(730, opts.tage ?? 4));
  const heute = berlinTag.format(new Date());
  const gestern = plusTage(heute, -1);

  const me = await ig<{ followers_count: number }>("me?fields=followers_count", token);

  const zeilen: Array<Omit<InstagramTag, "follower" | "rekonstruiert">> = [];
  let bisAm: string | null = null;
  for (let i = 0; i < tage; i++) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    const tag = plusTage(gestern, -i);
    try {
      zeilen.push(await holeTag(tag, token));
      bisAm = tag;
    } catch (e) {
      // ältere Tage gibt Instagram irgendwann nicht mehr her → beim Nachtragen hier aufhören
      if (i > 3) break;
      throw e;
    }
  }

  // bestehende Zeilen laden, neue Werte drüberlegen, Follower-Stände neu rechnen
  const { data: alt } = await sb.from("instagram_tag").select("*").gte("tag", plusTage(gestern, -Math.max(tage, 800)));
  const map = new Map<string, InstagramTag>(((alt ?? []) as InstagramTag[]).map((z) => [z.tag, z]));
  for (const z of zeilen) {
    const vorher = map.get(z.tag);
    map.set(z.tag, {
      follower: vorher?.follower ?? null,
      rekonstruiert: vorher ? vorher.rekonstruiert : true,
      ...z,
      // Follower-Zahlen nur überschreiben, wenn Instagram sie schon liefert
      neu: z.neu ?? vorher?.neu ?? null,
      verloren: z.verloren ?? vorher?.verloren ?? null,
    });
  }
  // Gemessener Stand: der aktuelle Follower-Stand gilt als Stand von gestern Abend
  // (Cron läuft morgens; die wenigen neuen Follower seit Mitternacht fallen nicht ins Gewicht).
  const g = map.get(gestern) ?? { tag: gestern, follower: null, rekonstruiert: false, neu: null, verloren: null, reichweite: null, aufrufe: null, profilaufrufe: null, website_klicks: null, interaktionen: null };
  if (g.rekonstruiert || g.follower == null) map.set(gestern, { ...g, follower: me.followers_count, rekonstruiert: false });

  const alle = rekonstruiere([...map.values()]);
  const stand = new Date().toISOString();
  for (let i = 0; i < alle.length; i += 500) {
    const { error } = await sb.from("instagram_tag").upsert(alle.slice(i, i + 500).map((z) => ({ ...z, stand })), { onConflict: "tag" });
    if (error) throw new Error(error.message);
  }

  try {
    const d = await holeDemografie(token);
    await sb.from("instagram_stand").upsert({ id: 1, demografie: d.demografie, online: d.online, stand }, { onConflict: "id" });
  } catch (e) {
    console.warn("[instagram] Demografie:", e instanceof Error ? e.message : e);
  }

  return { tage: zeilen.length, follower: me.followers_count, bisAm };
}

/** Aktueller Follower-Stand live (für den Startbildschirm). */
export async function holeFollowerLive(): Promise<number | null> {
  const token = await getMetaToken();
  if (!token) return null;
  try {
    return (await ig<{ followers_count: number }>("me?fields=followers_count", token)).followers_count;
  } catch {
    return null;
  }
}
