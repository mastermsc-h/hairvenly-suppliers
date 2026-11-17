import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logUsage } from "./usage-logger";
import {
  pairTeamReply, parseComparison, buildCompareInput, COMPARE_PROMPT, isDuplicateSuggestion,
  type MsgLite,
} from "./learning-core";

const MODEL = "claude-haiku-4-5";
/** Entwürfe ohne jede Antwort werden nach so vielen Tagen „expired". */
const EXPIRE_DAYS = 7;

export interface LearningRunResult {
  paired: number;
  expired: number;
  compared: number;
  suggestions: number;
  failed: number;
}

/**
 * Schritt 1: offene Entwürfe mit der darauffolgenden Antwort verknüpfen.
 *  - Team hat geantwortet  → superseded + team_reply_text
 *  - Bot (auto) hat geantwortet → expired
 *  - nichts nach EXPIRE_DAYS → expired
 */
async function pairPendingDrafts(svc: SupabaseClient): Promise<{ paired: number; expired: number }> {
  let paired = 0, expired = 0;
  const { data: drafts } = await svc
    .from("chat_drafts")
    .select("id, session_id, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(500);
  const expireBefore = Date.now() - EXPIRE_DAYS * 86_400_000;
  for (const d of drafts ?? []) {
    const { data: msgs } = await svc
      .from("chat_messages")
      .select("role, content, created_at, auto_sent, deleted_at")
      .eq("session_id", d.session_id)
      .gt("created_at", d.created_at)
      .order("created_at", { ascending: true })
      .limit(20);
    const r = pairTeamReply((msgs ?? []) as MsgLite[]);
    if (r.kind === "team") {
      await svc.from("chat_drafts").update({ status: "superseded", team_reply_text: r.text, team_reply_at: r.at }).eq("id", d.id).eq("status", "pending");
      paired++;
    } else if (r.kind === "other_reply" || new Date(d.created_at).getTime() < expireBefore) {
      await svc.from("chat_drafts").update({ status: "expired" }).eq("id", d.id).eq("status", "pending");
      expired++;
    }
  }
  return { paired, expired };
}

/** Schritt 2: verknüpfte Entwürfe mit der Team-Antwort vergleichen (Haiku) → Vorschläge. */
async function compareSuperseded(svc: SupabaseClient, limit: number): Promise<{ compared: number; suggestions: number; failed: number }> {
  let compared = 0, suggestions = 0, failed = 0;
  const { data: drafts } = await svc
    .from("chat_drafts")
    .select("id, session_id, original_text, created_at, team_reply_text")
    .eq("status", "superseded")
    .is("compared_at", null)
    .not("team_reply_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!drafts?.length) return { compared, suggestions, failed };
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Bereits offene/übernommene Vorschläge → keine Doppel-Vorschläge. Bewusst
  // NICHT gegen die FAQ deduplizieren: liegt der Bot trotz FAQ falsch, ist
  // genau das ein Fund (FAQ unklar oder falsch).
  const { data: known } = await svc.from("chatbot_learning_suggestions").select("faq_question").in("status", ["new", "accepted"]);
  const knownQuestions = (known ?? []).map((k) => k.faq_question as string);

  for (const d of drafts) {
    const [{ data: before }, { data: sess }] = await Promise.all([
      svc.from("chat_messages")
        .select("role, content, created_at")
        .eq("session_id", d.session_id)
        .lte("created_at", d.created_at)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(4),
      svc.from("chat_sessions").select("category").eq("id", d.session_id).maybeSingle(),
    ]);
    const customer = (before ?? []).slice().reverse()
      .map((m) => `[${m.role === "user" ? "Kundin" : m.role === "human_agent" ? "Team" : "Bot"}] ${m.content ?? ""}`)
      .join("\n");
    const t0 = Date.now();
    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 700,
        system: COMPARE_PROMPT,
        messages: [{ role: "user", content: buildCompareInput(customer, d.original_text ?? "", d.team_reply_text ?? "") }],
      });
      logUsage({ purpose: "learning_compare", model: MODEL, usage: res.usage, sessionId: d.session_id, durationMs: Date.now() - t0 });
      const raw = res.content[0]?.type === "text" ? res.content[0].text : "";
      const cmp = parseComparison(raw);
      if (!cmp) { failed++; continue; }
      await svc.from("chat_drafts").update({ compared_at: new Date().toISOString(), comparison: cmp }).eq("id", d.id);
      compared++;
      for (const f of cmp.facts) {
        if (isDuplicateSuggestion(f.faq_question, knownQuestions)) continue;
        knownQuestions.push(f.faq_question);
        const { error } = await svc.from("chatbot_learning_suggestions").insert({
          draft_id: d.id,
          session_id: d.session_id,
          category: sess?.category ?? null,
          kind: f.kind,
          fact: f.fact,
          bot_said: f.bot_said,
          faq_question: f.faq_question,
          faq_answer: f.faq_answer,
          team_reply_excerpt: (d.team_reply_text ?? "").slice(0, 600),
        });
        if (!error) suggestions++;
      }
    } catch (e) {
      failed++;
      console.warn("[learning] compare failed", d.id, (e as Error).message);
    }
  }
  return { compared, suggestions, failed };
}

export async function runLearningCycle(svc: SupabaseClient, opts: { limit?: number } = {}): Promise<LearningRunResult> {
  const p = await pairPendingDrafts(svc);
  const c = await compareSuperseded(svc, opts.limit ?? 60);
  return { ...p, ...c };
}
