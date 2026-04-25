import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

// Public, kein Auth — wird auch vom Shopify-Lieferschein-Renderer aufgerufen.
// Erzeugt ein PNG-QR aus dem `text` Query-Parameter.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text");
  const size = Math.min(parseInt(searchParams.get("size") ?? "240", 10) || 240, 800);

  if (!text) {
    return new NextResponse("Missing 'text' parameter", { status: 400 });
  }

  try {
    const buffer = await QRCode.toBuffer(text, {
      type: "png",
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#FFFFFF" },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    return new NextResponse(
      `QR generation failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 },
    );
  }
}
