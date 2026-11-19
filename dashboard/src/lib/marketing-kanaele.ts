// Marketing-Kanäle: Soll-Rhythmus je Kanal und was davon geschafft ist (server-only).
// Automatisch gesammelt: Instagram (Reels, Info-Beiträge, Storys), YouTube (Shorts, Videos über den
// öffentlichen Kanal-Feed), Blog (Shopify-Artikel). TikTok, Pinterest und Google-Beiträge haben keinen
// freien Zugang → das Team meldet sie im Widget mit „+1“.
import { createServiceClient } from "@/lib/supabase/server";
import { getMetaToken } from "@/lib/messaging/meta-token";
import { shopifyGraphQL } from "@/lib/shopify";

export type KanalId = "ig_reel" | "ig_info" | "ig_story" | "tiktok" | "yt_short" | "yt_video" | "pinterest" | "google" | "blog";

export interface KanalDef {
  id: KanalId;
  name: string;
  /** Kurzname für die Sprüche im Widget. */
  kurz: string;
  plattform: "instagram" | "tiktok" | "youtube" | "pinterest" | "google" | "blog";
  /** Soll: so viele Beiträge … */
  anzahl: number;
  /** … je so viele Tage. */
  tage: number;
  rhythmus: string;
  auto: boolean;
  link: string;
}

/** Vorgaben (User 19.11.2026). Hier ändern, wenn sich der Plan ändert. */
export const KANAELE: KanalDef[] = [
  { id: "ig_reel", name: "Instagram Reels", kurz: "Reels", plattform: "instagram", anzahl: 2, tage: 7, rhythmus: "2 pro Woche", auto: true, link: "https://www.instagram.com/hairvenly.de/reels/" },
  { id: "ig_info", name: "Instagram Info-Beitrag", kurz: "Der Info-Beitrag", plattform: "instagram", anzahl: 1, tage: 7, rhythmus: "1 pro Woche", auto: true, link: "https://www.instagram.com/hairvenly.de/" },
  { id: "ig_story", name: "Instagram Story", kurz: "Die Story", plattform: "instagram", anzahl: 1, tage: 2, rhythmus: "jeden 2. Tag", auto: true, link: "https://www.instagram.com/hairvenly.de/" },
  { id: "tiktok", name: "TikTok", kurz: "TikTok", plattform: "tiktok", anzahl: 1, tage: 2, rhythmus: "jeden 2. Tag", auto: false, link: "https://www.tiktok.com/@hairvenly.de" },
  { id: "yt_short", name: "YouTube Shorts", kurz: "Shorts", plattform: "youtube", anzahl: 1, tage: 2, rhythmus: "jeden 2. Tag", auto: true, link: "https://www.youtube.com/@hairvenlyde/shorts" },
  { id: "yt_video", name: "YouTube Video", kurz: "Das YouTube-Video", plattform: "youtube", anzahl: 1, tage: 7, rhythmus: "1 pro Woche", auto: true, link: "https://www.youtube.com/@hairvenlyde/videos" },
  { id: "pinterest", name: "Pinterest", kurz: "Pinterest", plattform: "pinterest", anzahl: 1, tage: 2, rhythmus: "jeden 2. Tag", auto: false, link: "https://www.pinterest.com/" },
  { id: "google", name: "Google-Beitrag", kurz: "Der Google-Beitrag", plattform: "google", anzahl: 1, tage: 14, rhythmus: "alle 2 Wochen", auto: false, link: "https://business.google.com/posts" },
  { id: "blog", name: "Blog-Artikel", kurz: "Der Blog", plattform: "blog", anzahl: 1, tage: 14, rhythmus: "alle 2 Wochen", auto: true, link: "https://www.hairvenly.de/blogs" },
];

const YT_KANAL = "UCPeehutEMt0dBMpaH-DtjUA"; // @hairvenlyde

interface Zeile { kanal: KanalId; extern_id: string; zeitpunkt: string; titel: string | null }

async function instagram(): Promise<Zeile[]> {
  const token = await getMetaToken();
  if (!token) throw new Error("Instagram: kein Token");
  const api = "https://graph.instagram.com/v23.0/me";
  const hole = async (pfad: string) => {
    const r = await fetch(`${api}/${pfad}&access_token=${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as { data?: Array<{ id: string; timestamp: string; media_type?: string; media_product_type?: string; caption?: string }>; error?: { message: string } };
    if (j.error) throw new Error(`Instagram: ${j.error.message}`);
    return j.data ?? [];
  };
  const [media, storys] = await Promise.all([
    hole("media?fields=id,timestamp,media_type,media_product_type,caption&limit=50"),
    hole("stories?fields=id,timestamp,media_type"),
  ]);
  const out: Zeile[] = media.map((m) => ({
    kanal: m.media_product_type === "REELS" ? "ig_reel" : "ig_info",
    extern_id: m.id, zeitpunkt: m.timestamp, titel: (m.caption ?? "").split("\n")[0].slice(0, 120) || null,
  }));
  for (const s of storys) out.push({ kanal: "ig_story", extern_id: s.id, zeitpunkt: s.timestamp, titel: null });
  return out;
}

async function youtube(): Promise<Zeile[]> {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${YT_KANAL}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`YouTube ${r.status}`);
  const xml = await r.text();
  return xml.split("<entry>").slice(1).map((e) => {
    const id = e.match(/<yt:videoId>([^<]+)/)?.[1] ?? "";
    const kurz = /href="https:\/\/www\.youtube\.com\/shorts\//.test(e);
    const titel = (e.match(/<title>([^<]*)/)?.[1] ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return { kanal: (kurz ? "yt_short" : "yt_video") as KanalId, extern_id: id, zeitpunkt: e.match(/<published>([^<]+)/)?.[1] ?? "", titel: titel.slice(0, 120) };
  }).filter((z) => z.extern_id && z.zeitpunkt);
}

async function blog(): Promise<Zeile[]> {
  const d = await shopifyGraphQL<{ articles: { nodes: Array<{ id: string; title: string; publishedAt: string | null }> } }>(
    `{ articles(first: 20, sortKey: PUBLISHED_AT, reverse: true) { nodes { id title publishedAt } } }`,
  );
  if (!d.data) throw new Error(`Blog: ${JSON.stringify(d.errors ?? "keine Daten").slice(0, 160)}`);
  return d.data.articles.nodes.filter((a) => a.publishedAt).map((a) => ({ kanal: "blog" as KanalId, extern_id: a.id, zeitpunkt: a.publishedAt!, titel: a.title.slice(0, 120) }));
}

/** Holt neue Beiträge aller automatischen Quellen und speichert sie (vorhandene bleiben unverändert). */
export async function sammleBeitraege(): Promise<{ neu: number; fehler: string[] }> {
  const fehler: string[] = [];
  const teile = await Promise.allSettled([instagram(), youtube(), blog()]);
  const zeilen: Zeile[] = [];
  teile.forEach((t, i) => {
    if (t.status === "fulfilled") zeilen.push(...t.value);
    else fehler.push(`${["Instagram", "YouTube", "Blog"][i]}: ${t.reason instanceof Error ? t.reason.message : String(t.reason)}`);
  });
  if (!zeilen.length) return { neu: 0, fehler };
  const { data, error } = await createServiceClient()
    .from("marketing_beitraege")
    .upsert(zeilen.map((z) => ({ ...z, quelle: "auto" })), { onConflict: "kanal,extern_id", ignoreDuplicates: true })
    .select("id");
  if (error) fehler.push(`Speichern: ${error.message}`);
  return { neu: data?.length ?? 0, fehler };
}

export type KanalStatus = "geschafft" | "knapp" | "schlaeft";

export interface KanalStand extends KanalDef {
  /** Betrachtungsfenster in Tagen (mind. eine Woche). */
  fenster: number;
  soll: number;
  ist: number;
  letzter: string | null;
  tageSeit: number | null;
  status: KanalStatus;
  /** Je Tag des Fensters (ältester zuerst): Anzahl Beiträge. */
  tage14: number[];
  letzteManuell: { id: string; zeitpunkt: string } | null;
}

const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });

export async function ladeKanalStaende(): Promise<{ kanaele: KanalStand[]; stand: string | null; heute: string }> {
  const seit = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const { data, error } = await createServiceClient()
    .from("marketing_beitraege")
    .select("id, kanal, zeitpunkt, quelle, erstellt_am")
    .gte("zeitpunkt", seit)
    .order("zeitpunkt", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; kanal: KanalId; zeitpunkt: string; quelle: string; erstellt_am: string }>;
  const heute = berlin.format(new Date());
  const tagIdx = (iso: string) => Math.round((Date.parse(`${heute}T12:00:00Z`) - Date.parse(`${berlin.format(new Date(iso))}T12:00:00Z`)) / 86_400_000);
  const kanaele = KANAELE.map((k): KanalStand => {
    const eigene = rows.filter((r) => r.kanal === k.id);
    const fenster = Math.max(7, k.tage);
    const sollGenau = (k.anzahl * fenster) / k.tage;
    const soll = Math.max(1, Math.floor(sollGenau)); // „jeden 2. Tag“ = 3 pro Woche gelten als geschafft
    const ist = eigene.filter((r) => tagIdx(r.zeitpunkt) < fenster).length;
    const letzter = eigene[0]?.zeitpunkt ?? null;
    const tageSeit = letzter ? tagIdx(letzter) : null;
    // eingeschlafen: nichts im Fenster oder letzter Beitrag älter als der doppelte Rhythmus
    const schlaeft = ist === 0 || tageSeit == null || tageSeit > 2 * (k.tage / k.anzahl);
    const status: KanalStatus = ist >= soll ? "geschafft" : schlaeft ? "schlaeft" : "knapp";
    const tage14 = Array.from({ length: 14 }, (_, i) => eigene.filter((r) => tagIdx(r.zeitpunkt) === 13 - i).length);
    const manuell = eigene.find((r) => r.quelle === "manuell" && Date.now() - Date.parse(r.erstellt_am) < 36 * 3600_000);
    return { ...k, fenster, soll, ist, letzter, tageSeit, status, tage14, letzteManuell: manuell ? { id: manuell.id, zeitpunkt: manuell.zeitpunkt } : null };
  });
  const stand = rows.find((r) => r.quelle === "auto")?.erstellt_am ?? null;
  return { kanaele, stand, heute };
}
