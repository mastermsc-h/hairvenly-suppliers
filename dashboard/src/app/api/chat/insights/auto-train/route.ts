/**
 * POST /api/chat/insights/auto-train
 *
 * Triggert das Auto-Training: zieht Muster aus Lost-Deals und erzeugt
 * globale Trainings-Einträge in chatbot_training.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateTrainingFromInsights } from "@/lib/chatbot/training-from-insights";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function POST() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const result = await generateTrainingFromInsights();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
