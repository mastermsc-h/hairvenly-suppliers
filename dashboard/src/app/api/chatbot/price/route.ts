/**
 * GET /api/chatbot/price?method=tape&length=65&grams=150
 *
 * Returns pack calculation for the chatbot.
 * Used by the AI chatbot to answer "Wie viel kostet X?"
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calcPacks, type Method, type PriceRow } from "@/lib/chatbot/pricing";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const method  = searchParams.get("method") as Method | null;
  const length  = parseInt(searchParams.get("length") ?? "65");
  const grams   = parseInt(searchParams.get("grams") ?? "100");

  if (!method) {
    return NextResponse.json({ error: "method required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: prices, error } = await supabase
    .from("chatbot_prices")
    .select("method, length_cm, gram_label, gram_per_pack, price_eur, supplier_line")
    .eq("active", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = calcPacks(prices as PriceRow[], method, length, grams);

  if (!result) {
    return NextResponse.json(
      { error: `Keine Preisdaten für ${method} ${length}cm` },
      { status: 404 }
    );
  }

  return NextResponse.json(result);
}

/** GET /api/chatbot/price/all — alle Preise als Lookup-Tabelle */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chatbot_prices")
    .select("*")
    .eq("active", true)
    .order("method")
    .order("length_cm");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
