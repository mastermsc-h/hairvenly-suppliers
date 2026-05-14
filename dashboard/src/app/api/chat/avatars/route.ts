/**
 * GET /api/chat/avatars  (public — für Customer-Widget + Dashboard-Selektoren)
 *
 * Liefert nur aktive Avatars mit minimalen Infos für die Auswahl.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const svc = createServiceClient();
  const { data } = await svc
    .from("chatbot_avatars")
    .select("name, avatar_url")
    .eq("active", true)
    .order("name", { ascending: true });
  return NextResponse.json({ avatars: data || [] });
}
