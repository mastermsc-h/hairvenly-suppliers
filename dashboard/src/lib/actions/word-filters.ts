"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const svc = createServiceClient();
  const { data: profile } = await svc.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) throw new Error("Admin only");
  return svc;
}

export async function toggleWordFilter(id: string, active: boolean) {
  const svc = await requireAdmin();
  await svc.from("chatbot_word_filters").update({ active }).eq("id", id);
  revalidatePath("/chatbot/word-filters");
}

export async function updateWordFilterReplacement(id: string, replacement: string) {
  const svc = await requireAdmin();
  await svc.from("chatbot_word_filters").update({ replacement: replacement.trim() }).eq("id", id);
  revalidatePath("/chatbot/word-filters");
}

export async function deleteWordFilter(id: string) {
  const svc = await requireAdmin();
  await svc.from("chatbot_word_filters").delete().eq("id", id);
  revalidatePath("/chatbot/word-filters");
}

/** Manuelle Anlage eines neuen Filters */
export async function createWordFilter(pattern: string, replacement: string) {
  const svc = await requireAdmin();
  await svc.from("chatbot_word_filters").insert({
    pattern: pattern.trim().toLowerCase(),
    replacement: replacement.trim(),
    active: true,
    auto_added: false,
    occurrences: 0,
    notes: "Manuell hinzugefügt",
  });
  revalidatePath("/chatbot/word-filters");
}
