/**
 * LIGHT Instagram-Sync — dünner Route-Wrapper um runIgLightSync().
 *
 * Die Kern-Logik liegt in @/lib/chatbot/ig-light-sync (damit sie auch
 * piggyback aus inbox-stats aufgerufen werden kann — Hobby-Plan hat keinen
 * 10-Minuten-Cron). Diese Route bleibt als manueller/externer Trigger erhalten.
 *
 * Debug: ?debug=1 → dumpt die rohen Graph-Conversations (username +
 * unread_count + updated_time), ohne DB-Writes. Zum Prüfen ob IG ein
 * "als ungelesen markiert" via unread_count überhaupt zurückgibt.
 */
import { NextResponse } from "next/server";
import { runIgLightSync } from "@/lib/chatbot/ig-light-sync";

const GRAPH_VERSION = "v22.0";

export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.get("debug");
  if (debug) return debugDump(debug);
  return POST();
}

export async function POST() {
  const result = await runIgLightSync();
  const status = "error" in result
    ? (result.error === "Meta credentials missing" ? 500 : 502)
    : 200;
  return NextResponse.json(result, { status });
}

async function debugDump(filter: string) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const igUserId = process.env.META_INSTAGRAM_USER_ID;
  if (!token || !igUserId) return NextResponse.json({ error: "creds missing" }, { status: 500 });
  const host = token.startsWith("IGAA") ? "https://graph.instagram.com" : "https://graph.facebook.com";

  // Über mehrere Seiten paginieren um zu sehen wie viele Conversations es WIRKLICH gibt
  let url: string | null = `${host}/${GRAPH_VERSION}/${igUserId}/conversations?platform=instagram` +
    `&fields=id,unread_count,updated_time,participants&limit=50&access_token=${encodeURIComponent(token)}`;
  const all: { username: string; unread: number; updated: string }[] = [];
  let pages = 0;
  while (url && pages < 10) {
    const res: Response = await fetch(url);
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: "graph", details: data.error }, { status: 502 });
    for (const c of (data.data || [])) {
      const p = (c.participants?.data || []).find((pp: { id: string }) => pp.id !== igUserId);
      all.push({ username: p?.username || p?.name || p?.id || "?", unread: c.unread_count ?? -1, updated: c.updated_time || "" });
    }
    url = data.paging?.next || null;
    pages++;
  }
  const needle = filter === "1" ? null : filter.toLowerCase();
  const matched = needle ? all.filter(x => x.username.toLowerCase().includes(needle)) : all;
  return NextResponse.json({
    total_conversations: all.length,
    pages_fetched: pages,
    with_unread_gt0: all.filter(x => x.unread > 0).length,
    matched: matched.slice(0, 20),
    top10_by_unread: [...all].sort((a, b) => b.unread - a.unread).slice(0, 10),
  });
}
