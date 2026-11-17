"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";

async function requireAdminUser() {
  const sup = await createClient();
  const { data: { user } } = await sup.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const svc = createServiceClient();
  const { data: profile } = await svc.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) throw new Error("Nur für Admins");
  return { user, svc };
}

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

/** Vorschlag (ggf. bearbeitet) als aktive FAQ übernehmen — der Bot nutzt sie ab sofort. */
export async function acceptLearningSuggestion(id: string, question: string, answer: string, topic: string) {
  const { user, svc } = await requireAdminUser();
  const q = question.trim(), a = answer.trim(), t = topic.trim() || "allgemein";
  if (q.length < 5 || a.length < 5) throw new Error("Frage und Antwort ausfüllen");
  const { data: sug } = await svc.from("chatbot_learning_suggestions").select("status").eq("id", id).maybeSingle();
  if (!sug) throw new Error("Vorschlag nicht gefunden");
  if (sug.status !== "new") throw new Error("Vorschlag wurde schon bearbeitet");
  const { data: faq, error } = await svc.from("chatbot_faq").insert({
    slug: `${slugify(q)}_${Date.now().toString(36)}`,
    topic: t,
    question: q,
    answer: a,
    order_idx: 999,
    notes: "Aus Lernschleife (Entwurf vs. Team-Antwort) übernommen",
    active: true,
  }).select("id").single();
  if (error) throw new Error(error.message);
  await svc.from("chatbot_learning_suggestions").update({
    status: "accepted", faq_id: faq.id, faq_question: q, faq_answer: a,
    decided_by: user.id, decided_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/chatbot/lernen");
  revalidatePath("/chatbot");
}

export async function rejectLearningSuggestion(id: string) {
  const { user, svc } = await requireAdminUser();
  await svc.from("chatbot_learning_suggestions").update({
    status: "rejected", decided_by: user.id, decided_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "new");
  revalidatePath("/chatbot/lernen");
}

/** Abend-/Wochenend-Bot: off | shadow (Probelauf, sendet nichts) | live. */
export async function setOffhoursAutosend(mode: "off" | "shadow" | "live") {
  const { svc } = await requireAdminUser();
  if (!["off", "shadow", "live"].includes(mode)) throw new Error("Ungültiger Modus");
  const { error } = await svc.from("chatbot_settings").update({
    offhours_autosend: mode,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/chatbot/bot-settings");
  revalidatePath("/chatbot/lernen");
}
