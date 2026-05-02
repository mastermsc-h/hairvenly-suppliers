"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { ChatbotEntry } from "@/lib/types";
import { revalidatePath } from "next/cache";

// ── Fetch all entries (with optional filters) ────────────────────────────────
export async function getChatbotEntries(opts?: {
  topic?: string;
  search?: string;
  activeOnly?: boolean;
}): Promise<ChatbotEntry[]> {
  await requireProfile();
  const supabase = await createClient();

  let q = supabase
    .from("chatbot_knowledge")
    .select("*")
    .order("biz_score", { ascending: false })
    .order("created_at", { ascending: false });

  if (opts?.topic) q = q.eq("topic", opts.topic);
  if (opts?.activeOnly) q = q.eq("active", true);
  if (opts?.search) {
    const s = opts.search.trim();
    q = q.or(`question.ilike.%${s}%,answer.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ChatbotEntry[];
}

// ── Create entry ─────────────────────────────────────────────────────────────
export async function createChatbotEntry(fd: FormData): Promise<void> {
  await requireProfile();
  const supabase = await createClient();

  const { error } = await supabase.from("chatbot_knowledge").insert({
    topic:      fd.get("topic") as string,
    cluster:    (fd.get("cluster") as string) || (fd.get("topic") as string),
    question:   fd.get("question") as string,
    answer:     fd.get("answer") as string,
    biz_score:  parseInt(fd.get("biz_score") as string) || 3,
    conversion: fd.get("conversion") === "true",
    methods:    [],
    colors:     [],
    lengths:    [],
    grams:      [],
    source:     "manual",
    active:     true,
  });
  if (error) throw error;
  revalidatePath("/chatbot");
}

// ── Update entry ─────────────────────────────────────────────────────────────
export async function updateChatbotEntry(fd: FormData): Promise<void> {
  await requireProfile();
  const supabase = await createClient();

  const id = fd.get("id") as string;
  const { error } = await supabase
    .from("chatbot_knowledge")
    .update({
      topic:    fd.get("topic") as string,
      cluster:  (fd.get("cluster") as string) || (fd.get("topic") as string),
      question: fd.get("question") as string,
      answer:   fd.get("answer") as string,
      biz_score: parseInt(fd.get("biz_score") as string) || 3,
      conversion: fd.get("conversion") === "true",
      active:   fd.get("active") === "true",
    })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/chatbot");
}

// ── Toggle active ────────────────────────────────────────────────────────────
export async function toggleChatbotEntry(id: string, active: boolean): Promise<void> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("chatbot_knowledge")
    .update({ active })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/chatbot");
}

// ── Delete entry ─────────────────────────────────────────────────────────────
export async function deleteChatbotEntry(id: string): Promise<void> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("chatbot_knowledge")
    .delete()
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/chatbot");
}

// ── Get topic stats ──────────────────────────────────────────────────────────
export async function getChatbotStats(): Promise<{ topic: string; count: number; active: number }[]> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chatbot_knowledge")
    .select("topic, active");
  if (error) throw error;

  const map: Record<string, { count: number; active: number }> = {};
  for (const row of data ?? []) {
    if (!map[row.topic]) map[row.topic] = { count: 0, active: 0 };
    map[row.topic].count++;
    if (row.active) map[row.topic].active++;
  }
  return Object.entries(map)
    .map(([topic, v]) => ({ topic, ...v }))
    .sort((a, b) => b.count - a.count);
}
