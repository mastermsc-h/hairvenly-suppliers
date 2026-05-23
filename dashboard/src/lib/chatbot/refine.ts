/**
 * Refine-Loop für Bot-Begleitung: Mitarbeiter gibt Feedback in natürlicher
 * Sprache, Bot generiert die Antwort neu — basierend auf Verlauf + Feedback.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { applyAllOutputSanitizers } from "./output-sanitizers";

const MODEL = "claude-sonnet-4-5";

interface RefineResult {
  success: boolean;
  text?: string;
  error?: string;
}

export async function refineBotDraft(
  sessionId: string,
  currentDraftText: string,
  feedback: string,
): Promise<RefineResult> {
  if (!feedback?.trim()) return { success: false, error: "feedback leer" };

  const svc = createServiceClient();

  const { data: session } = await svc
    .from("chat_sessions")
    .select("id, bot_signature_name, channel")
    .eq("id", sessionId)
    .single();
  if (!session) return { success: false, error: "session not found" };
  const signatureName = session.bot_signature_name || "Lara";

  // Persona laden (gleiches Pattern wie respondAsBot)
  const { data: persona } = await svc
    .from("chatbot_persona").select("system_prompt")
    .eq("active", true).limit(1).single();
  if (!persona) return { success: false, error: "no persona" };

  const { data: avatars } = await svc.from("chatbot_avatars")
    .select("name, personality").eq("active", true);
  const avatarRow = (avatars || []).find(a => a.name === signatureName) || (avatars || [])[0];

  let systemPrompt = persona.system_prompt.replaceAll("{signature_name}", signatureName);
  if (avatarRow) {
    systemPrompt += `\n\n## DEINE PERSÖNLICHKEIT (als ${avatarRow.name})\n${avatarRow.personality}`;
  }

  // Refine-Spezifischer Zusatz
  systemPrompt += `

## REFINE-MODUS
Du hast bereits einen Antwort-Entwurf für die letzte Kundennachricht geschrieben.
Eine MITARBEITERIN hat dir Feedback gegeben, was du anders machen sollst.
Schreibe die Antwort komplett neu — unter Berücksichtigung dieses Feedbacks und des Gesprächsverlaufs.

WICHTIG:
- Antworte AUSSCHLIESSLICH mit der neuen Antwort an den Kunden (keine Meta-Kommentare wie "Hier ist die überarbeitete Version:")
- Behalte deine Tonalität und die Avatare-Persönlichkeit bei
- Nimm das Feedback ernst — die Mitarbeiterin kennt den Kontext besser
- Keine Tool-Calls, du hast die Daten schon aus dem ersten Versuch`;

  // Conversation laden
  const { data: msgsDesc } = await svc
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(30);
  const msgs = (msgsDesc || []).slice().reverse();

  const messages: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content || "" });
    } else if (m.role === "assistant" || m.role === "human_agent") {
      messages.push({ role: "assistant", content: m.content || "" });
    }
  }

  // Hänge den aktuellen Entwurf als letzten Bot-Turn an + Feedback als User-Turn
  messages.push({ role: "assistant", content: currentDraftText });
  messages.push({
    role: "user",
    content: `[FEEDBACK DER MITARBEITERIN — KEINE KUNDENNACHRICHT]\n${feedback.trim()}\n\nSchreibe deine vorherige Antwort an den Kunden unter Berücksichtigung dieses Feedbacks komplett neu. Antworte nur mit der neuen Kundenantwort.`,
  });

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const refineStart = Date.now();
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } as const },
      ],
      messages,
    });
    const { logUsage } = await import("./usage-logger");
    logUsage({
      purpose: "refine",
      model: MODEL,
      usage: resp.usage,
      sessionId,
      durationMs: Date.now() - refineStart,
    });
    const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    let newText = textBlocks.map(b => b.text).join("\n").trim();
    if (!newText) return { success: false, error: "leere Antwort" };
    // Safety-Net: verbotene Wörter + Lagerzahlen rausfiltern (gleiche Logik wie in respond.ts)
    newText = newText
      // Verbotene Fachwörter
      .replace(/\bGrammatur\b/g, "Menge")
      .replace(/\bgrammatur\b/g, "menge")
      // "in begrenzter Menge"-Phrase komplett entfernen — verboten
      .replace(/\(?\s*(?:in\s+)?begrenzter?\s+Menge\s*(?=à\s*\d+\s*g)/gi, "")
      .replace(/\s*,?\s*\(?(?:in\s+)?begrenzter?\s+Menge\)?\s*/gi, " ")
      // ZUERST Bestand/Quantity = 0 → ausverkauft (vor generischer Zahlen-Regel)
      .replace(/\b(?:Lager(?:bestand)?|Bestand)\s*[:=]?\s*0\s*g?\b/gi, "ausverkauft")
      .replace(/\bQuantity\s*[:=]?\s*0\b/gi, "ausverkauft")
      .replace(/\(?\s*\d{2,5}\s*g(?:ramm)?\s*(?:auf\s*Lager|verfügbar|vorrätig|im\s*Lager|da)\s*\)?/gi, "haben wir da")
      .replace(/\b\d{2,5}\s*g(?:ramm)?\b\s*\b(?:verfügbar|vorrätig|am\s*Lager)\b/gi, "verfügbar")
      .replace(/\b(?:Lager(?:bestand)?|Bestand)\s*[:=]?\s*\d{1,5}\s*g?\b/gi, "verfügbar")
      .replace(/\bQuantity\s*[:=]?\s*\d+\b/gi, "")
      // NUR Stock-Leaks ("noch X Stück") abfangen, NICHT normale Preis-Kalk
      .replace(/\b(noch|nur\s+noch)\s+\d{1,3}\s*(Stück|Packungen)\b/gi, "$1 etwas")
      .replace(/\(\s*\)/g, "")
      .replace(/[ \t]{2,}/g, " ");
    // Auto-Lern-Filter aus DB anwenden
    try {
      const { loadActiveWordFilters, applyWordFilters } = await import("@/lib/chatbot/word-filter-learning");
      const filters = await loadActiveWordFilters();
      if (filters.length > 0) newText = applyWordFilters(newText, filters);
    } catch (e) {
      console.warn("[refine] word-filter apply failed:", (e as Error).message);
    }

    // Shared Output-Sanitizer anwenden — gleiche Regeln wie initialer Bot-Call:
    // Klammer-Disclaimer, proaktive Foto-Angebote, Lieferanten-Namen,
    // Wochenende-Falle, Closed-Handover, Em-Dash-Bremse.
    // customerAskedForPhotos: aus den letzten 3 Customer-Messages bestimmen.
    const recentCustomerMsgs = (msgs || []).filter(m => m.role === "user").slice(-3);
    const customerAskedForPhotos = recentCustomerMsgs.some(m => {
      const txt = (m.content || "").toLowerCase();
      const hasMediaWord = /\b(fotos?|videos?|bilder|aufnahmen|aufnahme)\b/.test(txt);
      const hasQuestion = /\?/.test(txt) ||
        /\b(habt\s+ihr|hättet\s+ihr|hättest|könnt\s+ihr|könntet\s+ihr|magst|wäre.{0,20}möglich|gibt['e\s]+es|schickt\s+(mir|ihr))\b/i.test(txt);
      return hasMediaWord && hasQuestion;
    });

    // Auto-URL für Farben: tool_results aus dem aktuellen Draft auslesen.
    const colorUrlMap = new Map<string, string>();
    try {
      const { data: draft } = await svc.from("chat_drafts")
        .select("tool_results")
        .eq("session_id", sessionId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      const toolResults = (draft?.tool_results as Array<{ content?: string }> | null) || [];
      for (const r of toolResults) {
        try {
          const parsed = JSON.parse(r.content || "{}") as Record<string, unknown>;
          const lists: Array<Record<string, unknown>[]> = [];
          for (const k of ["coming_soon", "still_coming", "sold_out_or_coming", "inventory_available", "variants", "colors"]) {
            const v = parsed[k];
            if (Array.isArray(v)) lists.push(v as Record<string, unknown>[]);
          }
          for (const list of lists) {
            for (const item of list) {
              const url = String(item.shopify_url || "");
              if (!url) continue;
              const colorName = String(item.color_name || item.name_hairvenly || "");
              const product = String(item.product || item.name_shopify || "");
              if (colorName) colorUrlMap.set(colorName.toUpperCase().trim(), url);
              const m = product.match(/^#?([A-ZÄÖÜ][A-ZÄÖÜ\s/+\-_0-9]{1,40})\s+[-–—]/);
              if (m) colorUrlMap.set(m[1].toUpperCase().trim(), url);
            }
          }
        } catch { /* skip */ }
      }
    } catch (e) {
      console.warn("[refine] tool_results lookup failed:", (e as Error).message);
    }

    newText = applyAllOutputSanitizers(newText, { customerAskedForPhotos, colorUrlMap });

    return { success: true, text: newText };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
