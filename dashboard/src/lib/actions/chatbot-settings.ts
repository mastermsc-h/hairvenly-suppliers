"use server";

import { createServiceClient, createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Granularer Kill-Switch + Safe-Categories.
 *
 * - proactive_generation_enabled = true → Bot generiert IMMER proaktiv
 * - proactive_generation_enabled = false → Bot generiert nur für Sessions
 *   deren Kategorie in proactive_safe_categories enthalten ist
 *
 * Wenn safe-categories LEER und enabled=false → null Auto-Antworten. Das
 * sollte sichtbar in der UI warnen, sonst wundert sich die MA warum nichts
 * auto-beantwortet wird (User-Bug 2026-05-29).
 */
export async function setProactiveKillSwitch(opts: {
  enabled?: boolean;
  safeCategories?: string[];
}) {
  const sup = await createClient();
  const { data: { user } } = await sup.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  const update: { proactive_generation_enabled?: boolean; proactive_safe_categories?: string[]; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (typeof opts.enabled === "boolean") update.proactive_generation_enabled = opts.enabled;
  if (Array.isArray(opts.safeCategories)) update.proactive_safe_categories = opts.safeCategories;

  await svc.from("chatbot_settings").update(update).eq("id", 1);
  revalidatePath("/chatbot/bot-settings");
  revalidatePath("/chatbot/inbox");
}
