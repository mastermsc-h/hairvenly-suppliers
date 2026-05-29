/**
 * Instagram-CDN-Image-Proxy.
 *
 * Hintergrund: Story-/Reels-/Share-URLs aus Meta-Webhooks (z.B. von einer
 * Story-Reply) zeigen auf scontent.cdninstagram.com / fbcdn.net Hosts. Diese
 * CDN-Hosts liefern bei direkten Browser-Requests häufig 403 oder 0 Bytes
 * (Hot-Link-Schutz / Referrer-Check). Der Browser feuert dann onError und
 * unsere UI denkt fälschlich "Link abgelaufen", obwohl er noch lebt
 * (User-Bug 2026-05-29 — Story-Replies 23 Min alt wurden als ">24h"
 * markiert).
 *
 * Fix: Server-seitig fetchen, mit ordentlichem User-Agent. Antwort wird an
 * den Browser durchgereicht. Server sitzt nicht hinter dem Hot-Link-Filter
 * → die CDN gibt's frei.
 *
 * Safety:
 *   - Nur Meta-CDN-Hosts erlaubt (cdninstagram.com / fbcdn.net) — kein
 *     offener SSRF-Proxy
 *   - Eingeloggter Nutzer Pflicht (requireProfile)
 *   - Max-Size-Cap (10 MB), damit niemand uns einen 1 GB-Stream durchschickt
 *   - Cache-Control: privat 1h, damit der Browser nicht jedes Reload
 *     erneut fetcht
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";

const ALLOWED_HOST_RE = /\.(?:cdninstagram\.com|fbcdn\.net)$/i;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

export async function GET(req: NextRequest) {
  await requireProfile(); // Login-Pflicht

  const urlParam = req.nextUrl.searchParams.get("url");
  if (!urlParam) {
    return NextResponse.json({ error: "Missing ?url=" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (target.protocol !== "https:") {
    return NextResponse.json({ error: "Only https allowed" }, { status: 400 });
  }
  if (!ALLOWED_HOST_RE.test(target.hostname)) {
    return NextResponse.json(
      { error: "Host not allowed (only Meta-CDN)" },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent": UA,
        Accept: "image/avif,image/webp,image/jpeg,image/png,*/*",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status}` },
        { status: upstream.status }
      );
    }

    // Size-Cap via Content-Length-Header (best-effort)
    const lenHdr = upstream.headers.get("content-length");
    if (lenHdr && Number(lenHdr) > MAX_BYTES) {
      return NextResponse.json({ error: "Too large" }, { status: 413 });
    }

    const contentType =
      upstream.headers.get("content-type") || "image/jpeg";
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "Too large" }, { status: 413 });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600, immutable",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Fetch failed", details: (e as Error).message },
      { status: 502 }
    );
  }
}
