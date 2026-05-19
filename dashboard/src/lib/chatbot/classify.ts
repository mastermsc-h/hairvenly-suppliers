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
  | "gewerbe"
  | "partnership"
  | "general";

const CATEGORY_DESC: Record<Category, string> = {
  availability:  "Verfügbarkeit / Lager — 'habt ihr X auf Lager?', 'wann kommt Y wieder?', 'noch da?', Anfragen zu bestimmten Farben oder Mengen",
  pricing:       "Preis / Kosten — 'was kostet eine Verlängerung?', Rabatte, Zahlungsfragen, Versandkosten, 'wie viel für 100g'",
  color_advice:  "Farbberatung — 'welche Farbe passt zu #2A?', Farb-Match, Foto-Beratung, 'bin skeptisch welche Farbe', Beratungswunsch zu Farbton/Haar",
  appointment:   "Termin / Salon — Buchungsanfragen, Beratungstermin, Ansatz färben, Showroom-Besuch, vor Ort vorbeikommen, im Laden anschauen",
  complaint:     "Reklamation / Beschwerde — Beschädigung, Unzufriedenheit, falsche Lieferung, Rückgabe-Anfragen, Problem mit Produkt",
  order_status:  "Bestellstatus — 'wo ist meine Bestellung?', Tracking, Versand-Probleme, Bestellung nicht angekommen, Rechnungsfragen",
  gewerbe:       "Gewerbe / B2B-Kundin — Friseurin/Salon will Extensions kaufen, Gewerbenachweis, Netto-Preise, Wiederverkäufer-Anfrage, 'ich bin Friseurin und möchte für meinen Salon bestellen'",
  partnership:   "Partnership / Lieferanten-Outreach von Drittanbietern — 'we sell hair extensions to you', Kooperations-Spam, externe Firmen die UNS etwas verkaufen wollen, Jobsuche/Mitarbeitersuche ('eleman ariyormusunuz')",
  general:       "Sonstiges / unklar — NUR verwenden wenn wirklich keine der anderen Kategorien passt (z.B. reine Begrüßung ohne Anliegen, 'Dankeschön', unverständliche Nachricht)",
};

/**
 * Klassifiziert eine Session basierend auf den letzten ~5 Kundennachrichten.
 * Speichert das Ergebnis direkt in chat_sessions.category.
 * Idempotent — sicher mehrfach aufzurufen.
 */
export async function classifySession(sessionId: string): Promise<Category | null> {
  const svc = createServiceClient();

  // Manuelles Lock respektieren: wenn die Mitarbeiterin die Kategorie selbst
  // gesetzt hat, NICHT überschreiben. Nur reclassifySession() (= bewusster
  // Klick auf "Neu klassifizieren") setzt das Lock zurück.
  const { data: cur } = await svc
    .from("chat_sessions")
    .select("category, category_manual")
    .eq("id", sessionId)
    .maybeSingle();
  if (cur?.category_manual) {
    return (cur.category as Category) || null;
  }

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
      system: `Du klassifizierst Kundennachrichten an einen Haar-Extension-Shop (Hairvenly).
Wähle GENAU EINE Kategorie aus dieser Liste:

${categoryList}

WICHTIGE REGELN:
- "general" NUR verwenden wenn es WIRKLICH keine spezifische Kategorie ist (reine Grüße, "Danke", oder unverständlich)
- Bei Beratungswunsch zu Farbe / "welche Farbe passt" → color_advice (NICHT general)
- Bei "habt ihr X" / "auf Lager" / "noch da" → availability
- Bei "kann ich vorbeikommen" / "im Laden" / "Showroom" → appointment
- Bei "we have hair to sell" / "eleman ariyor" / Friseur-Outreach → partnership
- Bei konkretem Beratungswunsch zur Verlängerung → color_advice

Antworte AUSSCHLIESSLICH mit dem Kategorie-Key in Kleinbuchstaben (z.B. "availability") — kein Erklärtext, keine Anführungszeichen, kein Punkt.`,
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
