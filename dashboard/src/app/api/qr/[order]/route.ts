import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

// Public, kein Auth — wird vom Shopify-Lieferschein-Renderer (html2pdf) aufgerufen.
// Path-basiert, damit kein "&" im img-src vom Liquid-Template (manche
// HTML-zu-PDF-Renderer haben Probleme mit query-strings im src).
// Liefert SVG (kleiner + von PDF-Renderern besser unterstützt als PNG-RGBA).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ order: string }> },
) {
  const { order } = await params;
  const cleanOrder = order.replace(/\.svg$|\.png$/i, "");

  const origin = new URL(req.url).origin;
  const packUrl = `${origin}/pack/${encodeURIComponent(cleanOrder)}`;

  try {
    const svg = await QRCode.toString(packUrl, {
      type: "svg",
      margin: 2,
      width: 240,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#FFFFFF" },
    });

    return new NextResponse(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new NextResponse(
      `QR generation failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 },
    );
  }
}
