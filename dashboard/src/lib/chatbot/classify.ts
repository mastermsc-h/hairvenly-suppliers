/**
 * Auto-Kategorisierung einer Chat-Session via Haiku.
 * Wird beim Eingang einer Kundennachricht aufgerufen (oder manuell).
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

const MODEL = "claude-haiku-4-5";

export type Category =
  | "availability"
  | "pricing"
  | "color_advice"
  | "appointment"
  | "complaint"
  | "order_status"
  | "partnership"
  | "general";

const CATEGORY_DESC: Record<Category, string> = {
  availability:  "Verfügbarkeit / Lager — 'habt ihr X auf Lager?', 'wann kommt Y wieder?'",
  pricing:       "Preis / Kosten — 'was kostet eine Verlängerung?', Rabatte, Zahlungsfragen",
  color_advice:  "Farbberatung — 'welche Farbe passt zu #2A?', Farb-Match Fragen",
  appointment:   "Termin / Salon — Buchungsanfragen, Beratungstermin, Ansatz färben",
  complaint:     "Reklamation / Beschwerde — Beschädigung, Unzufriedenheit, Rückgabe",
  order_status:  "Bestellstatus — 'wo ist meine Bestellung?', Tracking, Versand-Probleme",
  partnership:   "Partnership / B2B — Lieferanten-Outreach, Kooperationsanfragen von Firmen",
  general:       "Sonstiges / unklar — alles was nicht in die anderen passt",
};

/**
 * Klassifiziert eine Session basierend auf den letzten ~5 Kundennachrichten.
 * Speichert das Ergebnis direkt in chat_sessions.category.
 * Idempotent — sicher mehrfach aufzurufen.
 */
export async function classifySession(sessionId: string): Promise<Category | null> {
  const svc = createServiceClient();
  const { data: msgs } = await svc
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(5);

  if (!msgs || msgs.length === 0) return null;
  const userText = msgs.slice().reverse()
    .map(m => (m.content || "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
  if (!userText) return null;

  const categoryList = Object.entries(CATEGORY_DESC)
    .map(([k, d]) => `- ${k}: ${d}`)
    .join("\n");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 50,
      system: `Du bist ein Klassifikator. Lies die Kundennachrichten und wähle EINE Kategorie aus dieser Liste:

${categoryList}

Antworte AUSSCHLIESSLICH mit dem Kategorie-Key (z.B. "availability") — kein Erklärtext, keine Anführungszeichen.`,
      messages: [{ role: "user", content: userText }],
    });
    const out = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text).join("").trim().toLowerCase();

    const valid: Category[] = ["availability","pricing","color_advice","appointment","complaint","order_status","partnership","general"];
    const cat = valid.find(v => out.includes(v)) || "general";
    await svc.from("chat_sessions").update({ category: cat }).eq("id", sessionId);
    return cat;
  } catch (e) {
    console.warn("[classify] failed:", (e as Error).message);
    return null;
  }
}
