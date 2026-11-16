// Vorschau (Bild + Instagram-Link) je Meta-Kampagne für /marketing.
// Quellen, in dieser Reihenfolge:
//  1. Bekannter Instagram-Link je Anzeigen-ID (aus marketing.hairvenly.de, lib/metaPostUrls.ts)
//  2. Bildunterschrift: beworbene Beiträge heißen "Instagram-Beitrag: <Anfang der Caption>..."
//     → Abgleich mit unseren Instagram-Beiträgen (Graph API, vorhandener Chatbot-Token)
//  3. Gespeichertes Anzeigenbild aus dem Marketing-Projekt (Supabase-Storage)
// Fehlt alles: Link in den Werbeanzeigenmanager.
import "server-only";
import { unstable_cache } from "next/cache";
import { getMetaToken } from "@/lib/messaging/meta-token";

export interface MetaVorschau {
  bild: string | null;
  link: string | null; // Instagram-Beitrag
  typ: "video" | "bild" | "karussell" | null;
  manager: string | null; // Werbeanzeigenmanager
  anzeigen: number;
}

const ADS_ACCOUNT_ID = "1909009262570556";
const manager = (adId: string) => `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ADS_ACCOUNT_ID}&selected_ad_ids=${adId}`;

// Stand 23.07.2026 + Nachträge, Quelle: hairvenly-marketing lib/metaPostUrls.ts (manuell gepflegt)
const POST_URLS: Record<string, string> = {
  "120240828027980652": "https://www.instagram.com/reel/DNxebLPUHPA/",
  "120231430409190652": "https://www.instagram.com/p/DFFnp_bNjbq/",
  "120231429969830652": "https://www.instagram.com/p/DGn0aPegyPN/",
  "120231528853420652": "https://www.instagram.com/p/DGny2-QgTim/",
  "120253094458260652": "https://www.instagram.com/p/DdrNdP_s_MG/",
  "120253384888010652": "https://www.instagram.com/p/DeZAp6MsgkN/",
  "120253440655500652": "https://www.instagram.com/p/DehAIuXs67k/",
  "120250818698340652": "https://www.instagram.com/reel/DD9oEx1N7F4/",
  "120252696122200652": "https://www.instagram.com/p/DcWesm9IJ-5/",
  "120252282327710652": "https://www.instagram.com/reel/DGDMQuuNp9M/",
  "120246784111120652": "https://www.instagram.com/reel/DGDMQuuNp9M/",
  "120249874088060652": "https://www.instagram.com/reel/DCCkxmvxdXG/",
  "120251429588560652": "https://www.instagram.com/reel/DaFPUJ8OgO9/",
  "120251515423150652": "https://www.instagram.com/reel/Dak_wRvoHTY/",
  "120239058570220652": "https://www.instagram.com/reel/DJ1GNuwt3z4/",
  "120231726934500652": "https://www.instagram.com/p/CtwqZ79g-zo/",
};

interface IgMedium {
  caption: string;
  norm: string;
  code: string; // Shortcode aus dem Permalink
  permalink: string;
  bild: string | null;
  typ: MetaVorschau["typ"];
}

const shortcode = (url: string) => url.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ?? "";
// Kleinbuchstaben, nur Buchstaben/Ziffern/@ — Emojis, Satzzeichen und Zeilenumbrüche raus
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}@]+/gu, " ").trim();

/** Eigene Instagram-Beiträge (bis 300), 3 h gecacht. Bild-URLs von Instagram sind befristet gültig. */
const ladeIgMedien = unstable_cache(
  async (): Promise<Omit<IgMedium, "norm">[]> => {
    const token = await getMetaToken();
    if (!token) return [];
    const host = token.startsWith("IGAA") ? "https://graph.instagram.com/v21.0" : "https://graph.facebook.com/v21.0";
    const out: Omit<IgMedium, "norm">[] = [];
    let url: string | null = `${host}/me/media?fields=caption,media_type,permalink,thumbnail_url,media_url&limit=100&access_token=${encodeURIComponent(token)}`;
    for (let seite = 0; seite < 3 && url; seite++) {
      const r: Response = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
      const j = (await r.json()) as { data?: { caption?: string; media_type: string; permalink: string; thumbnail_url?: string; media_url?: string }[]; paging?: { next?: string }; error?: { message: string } };
      if (j.error || !j.data) throw new Error(`Instagram: ${j.error?.message ?? `HTTP ${r.status}`}`);
      for (const m of j.data) {
        out.push({
          caption: m.caption ?? "",
          code: shortcode(m.permalink),
          permalink: m.permalink,
          bild: m.media_type === "VIDEO" ? m.thumbnail_url ?? null : m.media_url ?? m.thumbnail_url ?? null,
          typ: m.media_type === "VIDEO" ? "video" : m.media_type === "CAROUSEL_ALBUM" ? "karussell" : "bild",
        });
      }
      url = j.paging?.next ?? null;
    }
    return out;
  },
  ["meta-vorschau-ig-medien-v1"],
  { revalidate: 10800 },
);

/** Sucht den Beitrag zu einem Kampagnen- bzw. Anzeigennamen über den Caption-Anfang. */
function perCaption(name: string, medien: IgMedium[]): IgMedium | undefined {
  const roh = name.replace(/^Instagram-Beitrag:\s*/i, "").replace(/(\.\.\.|…)\s*$/, "");
  const teile = roh.includes("|") ? roh.split("|").map((t) => t.trim()) : [roh];
  for (const teil of teile) {
    const n = norm(teil);
    if (n.length < 12) continue; // zu kurz → zu viele Fehltreffer
    const treffer = medien.filter((m) => (roh === teil ? m.norm.startsWith(n) : m.norm.includes(n)));
    if (treffer.length) return treffer[0]; // neuester zuerst (API-Reihenfolge)
  }
  return undefined;
}

type KampagneRoh = { kampagne: string; anzeige_id: string | null; anzeige_name: string | null; bild: string | null; anzeigen: number };

/** Reine Zuordnung (testbar): Kampagne → Vorschau. medien: neueste zuerst. */
export function ordneZu(kampagnen: KampagneRoh[], medienRoh: Omit<IgMedium, "norm">[]): Map<string, MetaVorschau & { quelle: "id" | "caption" | "bild" | "keine" }> {
  const medien: IgMedium[] = medienRoh.map((m) => ({ ...m, norm: norm(m.caption) }));
  const perCode = new Map(medien.map((m) => [m.code, m]));
  const out = new Map<string, MetaVorschau & { quelle: "id" | "caption" | "bild" | "keine" }>();
  for (const k of kampagnen) {
    const bekannt = k.anzeige_id ? POST_URLS[k.anzeige_id] : undefined;
    const perId = bekannt ? perCode.get(shortcode(bekannt)) : undefined;
    // Bekannter Link hat Vorrang: liegt der Beitrag nicht im Profil (reiner Werbe-Beitrag), NICHT per
    // Caption raten — ältere Beiträge mit gleichem Textanfang zeigen sonst ein anderes Video.
    const perText = bekannt ? undefined : perCaption(k.kampagne, medien) ?? (k.anzeige_name ? perCaption(k.anzeige_name, medien) : undefined);
    const m = perId ?? perText;
    out.set(k.kampagne, {
      bild: m?.bild ?? k.bild ?? null,
      link: bekannt ?? m?.permalink ?? null,
      typ: m?.typ ?? (bekannt?.includes("/reel/") ? "video" : null),
      manager: k.anzeige_id ? manager(k.anzeige_id) : null,
      anzeigen: k.anzeigen,
      quelle: bekannt ? "id" : perText ? "caption" : k.bild ? "bild" : "keine",
    });
  }
  return out;
}

export async function ladeMetaVorschau(kampagnen: KampagneRoh[]): Promise<Map<string, MetaVorschau>> {
  let medien: Omit<IgMedium, "norm">[] = [];
  try {
    medien = await ladeIgMedien();
  } catch (e) {
    console.warn("[meta-vorschau]", e instanceof Error ? e.message : e);
  }
  return ordneZu(kampagnen, medien);
}
