"use server";

import { createServiceClient, createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Setzt das Default-Avatar des eingeloggten Users. Wird bei takeoverSession
 * und setBotMode genutzt, damit Bot-Antworten in von dieser MA betreuten
 * Sessions automatisch mit ihrer Persönlichkeit signiert sind.
 *
 * Übergeben "" / null → reset (zurück auf bisheriges Random-Verhalten).
 *
 * User-Wunsch 2026-05-29.
 */
export async function setMyDefaultAvatar(avatarName: string | null) {
  const sup = await createClient();
  const { data: { user } } = await sup.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();

  if (avatarName) {
    // Validierung: Avatar muss aktiv existieren
    const { data: av } = await svc
      .from("chatbot_avatars")
      .select("name")
      .eq("name", avatarName)
      .eq("active", true)
      .maybeSingle();
    if (!av) throw new Error(`Avatar "${avatarName}" existiert nicht oder ist inaktiv`);
  }

  await svc
    .from("profiles")
    .update({ default_avatar_name: avatarName || null })
    .eq("id", user.id);

  // Layout liest den Wert im Avatar-Chip → refresh
  revalidatePath("/", "layout");
  revalidatePath("/chatbot/inbox");
}

/**
 * Admin-Variante: Default-Avatar für eine ANDERE MA setzen (z.B. wenn Admin
 * neue Mitarbeiterin onboarded). Nur Admin darf das.
 */
export async function setUserDefaultAvatar(userId: string, avatarName: string | null) {
  const sup = await createClient();
  const { data: { user } } = await sup.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const svc = createServiceClient();
  const { data: caller } = await svc
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!caller?.is_admin) throw new Error("Admin only");

  if (avatarName) {
    const { data: av } = await svc
      .from("chatbot_avatars")
      .select("name")
      .eq("name", avatarName)
      .eq("active", true)
      .maybeSingle();
    if (!av) throw new Error(`Avatar "${avatarName}" existiert nicht oder ist inaktiv`);
  }

  await svc
    .from("profiles")
    .update({ default_avatar_name: avatarName || null })
    .eq("id", userId);

  revalidatePath("/admin/users");
}
