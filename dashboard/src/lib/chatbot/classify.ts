/**
 * Auto-Kategorisierung einer Chat-Session via Haiku.
 * Wird beim Eingang einer Kundennachricht aufgerufen (oder manuell).
 */
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
  | "models"
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
  models:        "Modelle / Model-Anfragen — Personen die als Haarmodell für Fotoshooting / Vorher-Nachher / Social-Media-Content arbeiten möchten ('ich würde gerne als Modell …'), Casting-Anfragen, Modelsuche-Antwort, vergünstigte Behandlung gegen Foto-Rechte, 'sucht ihr Modelle?'",
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

  const valid: Category[] = ["availability","pricing","color_advice","appointment","complaint","order_status","gewerbe","partnership","models","general"];
  // 💰 Mini-LLM: DeepSeek (günstig) mit automatischem Haiku-Fallback.
  // Validierung: DeepSeek-Antwort MUSS einen gültigen Kategorie-Key enthalten,
  // sonst greift der Haiku-Fallback → Qualität bleibt garantiert ≥ vorher.
  const SYSTEM = `Du klassifizierst Kundennachrichten an einen Haar-Extension-Shop (Hairvenly).
Wähle GENAU EINE Kategorie aus dieser Liste:

${categoryList}

WICHTIGE REGELN:
- "general" NUR verwenden wenn es WIRKLICH keine spezifische Kategorie ist (reine Grüße, "Danke", oder unverständlich)
- 🎨 color_advice hat VORRANG: Sobald die Kundin um eine FARB-EMPFEHLUNG bittet ("welche Farbe passt", "welche Farbe könnte passen", "sagt mir welche Farbe", "welcher Ton zu mir", "Farbberatung", schickt ein Foto ihrer Haare für Farbwahl) → IMMER color_advice. Das gilt AUCH wenn in denselben Nachrichten "ausverkauft", "auf Lager", "noch da" o.ä. vorkommt — die Farb-Empfehlungsbitte ist das eigentliche Anliegen, die Verfügbarkeit nur Nebenaspekt. NICHT availability wählen nur weil "ausverkauft" öfter vorkommt.
- Bei "habt ihr X" / "auf Lager" / "noch da" OHNE Farb-Empfehlungsbitte → availability
- Bei "kann ich vorbeikommen" / "im Laden" / "Showroom" → appointment
- Bei "we have hair to sell" / "eleman ariyor" / Friseur-Outreach → partnership
- 🧩 METHODEN-/EIGNUNGS-Fragen sind KEINE color_advice → general: "welche Extensions/Methode passt bei feinem/dünnem/kaputtem/lockigem Haar?", "was ist am schonendsten/besten?", "Tressen oder Tapes oder Bondings?", "welche Methode hält am besten?". Das ist Methoden-/Eignungsberatung (KEINE Farb-Beratung) und soll vom Bot beantwortet werden. color_advice ist NUR für FARBE/Farbton/Farb-Match — NICHT für die Methoden-/Technik-Wahl.
- Bei "ich würde gerne Modell sein" / "sucht ihr Modelle" / Casting-Anfrage → models
- ⏱️ Richte dich nach dem AKTUELLEN Anliegen der NEUESTEN Kundennachricht — nicht nach älteren Themen weiter oben im Verlauf. Wenn die letzte Nachricht eine Methoden-Frage ist, ist die Kategorie general (auch wenn vorher über Farbe gesprochen wurde).

Antworte AUSSCHLIESSLICH mit dem Kategorie-Key in Kleinbuchstaben (z.B. "availability") — kein Erklärtext, keine Anführungszeichen, kein Punkt.`;
  try {
    const { miniMessagesCreate } = await import("./mini-llm");
    const resp = await miniMessagesCreate(
      {
        model: MODEL,
        max_tokens: 50,
        system: SYSTEM,
        messages: [{ role: "user", content: userText }],
      },
      {
        purpose: "classify_category",
        sessionId,
        validate: (text) => {
          const t = text.toLowerCase();
          return valid.some((v) => t.includes(v));
        },
      }
    );
    const out = resp.content
      .filter((b) => b.type === "text")
      .map((b) => b.text).join("").trim().toLowerCase();

    const cat = valid.find(v => out.includes(v)) || "general";
    await svc.from("chat_sessions").update({ category: cat }).eq("id", sessionId);
    return cat;
  } catch (e) {
    console.warn("[classify] failed:", (e as Error).message);
    return null;
  }
}
