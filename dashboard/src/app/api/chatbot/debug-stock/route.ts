/**
 * Debug: Was sieht das get_stock_eta Tool im Google Sheet?
 * Admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { readDashboardAlerts, readInventorySheet } from "@/lib/stock-sheets";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const profile = await requireProfile();
  if (!profile.is_admin) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const q = (req.nextUrl.searchParams.get("q") || "raw").toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  try {
    const [russ, usbek, alerts] = await Promise.all([
      readInventorySheet("Russisch - GLATT"),
      readInventorySheet("Usbekisch - WELLIG"),
      readDashboardAlerts(),
    ]);
    const allRows = [
      ...russ.rows.map(r => ({ ...r, _sheet: "Russisch - GLATT" })),
      ...usbek.rows.map(r => ({ ...r, _sheet: "Usbekisch - WELLIG" })),
    ];
    const matchTokens = (text: string) => {
      const hay = text.toLowerCase();
      return tokens.every(t => hay.includes(t));
    };
    const matches = allRows.filter(r => matchTokens(`${r.collection} ${r.product}`));
    const matchedUnterwegs = alerts.unterwegs.filter(u => matchTokens(`${u.collection} ${u.product}`));
    const matchedNullbestand = alerts.nullbestand.filter(u => matchTokens(`${u.collection} ${u.product}`));

    return NextResponse.json({
      query: q,
      tokens,
      inventory_matches: matches.map(m => ({
        sheet: m._sheet,
        collection: m.collection,
        product: m.product,
        quantity: m.quantity,
        total_weight_g: m.totalWeight,
        unit_weight_g: m.unitWeight,
      })),
      unterwegs_matches: matchedUnterwegs,
      nullbestand_matches: matchedNullbestand,
      sheet_last_updated: russ.lastUpdated,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
