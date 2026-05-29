/**
 * Conversation-Reopen-Detector — erkennt wenn die Kundin nach langem Gap
 * NUR ein Attachment / eine Reaction / einen Story-Reply ohne Text-Inhalt
 * schickt, und der Bot deshalb GERN alte unbeantwortete Sach-Fragen aus
 * dem Verlauf neu aufgreift.
 *
 * BUG 2026-05-30: Kundin schreibt 19.05. "wie teuer ist das alles?", dann
 * 9 Tage Funkstille (MA schickt zwischendurch Fotos). Am 28.05. schickt
 * Kundin nur [Foto] (ig_reel). Bot reaktiviert die 9 Tage alte Preis-Frage
 * und liefert komplette Preis+Farb-Antwort. 1 Stunde später schickt Kundin
 * NOCHMAL [Foto] → Bot kopiert dieselbe Antwort.
 *
 * Klasse von Bugs (wir lösen NICHT nur den Einzelfall):
 *   1. Re-Open via [Foto] / [Video] / ig_reel / story_mention / story_reply
 *   2. Re-Open via reines Emoji / "?" / "hallo"
 *   3. Re-Open via Sticker
 *
 * Pre-LLM-Hint sagt dem Bot:
 *   - Die Customer-Re-Open hat KEINEN expliziten Text-Inhalt
 *   - Vor 48h+ liegt ein offenes Sach-Thema (z.B. Preis-Frage)
 *   - NICHT automatisch reaktivieren — Kundin müsste das selbst tun
 *   - Stattdessen kurz auf den Re-Open reagieren + EINE Klärungsfrage
 *
 * Force-Draft-Companion (im respond.ts): wenn der Bot trotz Hint die alte
 * Frage beantwortet (Preis-Berechnung, Produkt-Empfehlung mit Zahlen),
 * Antwort als Draft markieren — MA prüft Re-Open-Intent.
 */

type MsgRow = {
  role: "user" | "assistant" | "human_agent" | "system";
  content: string | null;
  attachments?: unknown;
  created_at: string;
};

const REOPEN_GAP_MS = 48 * 3600 * 1000; // 48h Werkstunden-unabhängig — relative wall-clock-Lücke

/** Pure non-text customer-message? */
function isNonTextOnly(msg: MsgRow): boolean {
  const c = (msg.content || "").trim();
  if (c.length === 0) return true;
  // Attachment-Labels die unser System einfügt
  const ATTACH_LABELS = /^\s*(\[foto\]|\[video\]|\[audio\]|\[bild\]|\[sticker\]|\[reel\]|\[story\]|\[reaction\]|ig_reel|story_mention|story_reply)\s*$/i;
  if (ATTACH_LABELS.test(c)) return true;
  // Multi-label Form "[Foto]\nig_reel"
  const lines = c.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every(l => ATTACH_LABELS.test(l))) return true;
  // Pure Emoji (1-6 Zeichen)
  if (c.length <= 6 && /^[\p{Emoji}\s💕❤🩷✨😊👍🙂🙏😘😍🥰]+$/u.test(c)) return true;
  // Single "?"
  if (/^[?!.]{1,3}$/.test(c)) return true;
  // Pure-Greeting (sehr kurz, kein Anliegen)
  if (/^(hallo|hi|hey|moin|servus|na\??)\s*[!?.💕❤🩷]*\s*$/i.test(c)) return true;
  return false;
}

/** Hat die Message substantiellen Text der eine Frage / ein Anliegen ausdrückt? */
function hasSubstantialText(msg: MsgRow): boolean {
  const c = (msg.content || "").trim();
  if (c.length < 8) return false;
  if (isNonTextOnly(msg)) return false;
  return true;
}

export type ConversationReopenAnalysis = {
  isReopenWithoutText: boolean;
  reason: string;
  gapHours: number | null;
  /** ältere Customer-Messages mit substantiellem Text (vor dem Gap) — diese
   *  Themen soll der Bot NICHT automatisch reaktivieren. */
  stalePendingTopics: string[];
};

/**
 * Analysiert die Conversation-History und gibt zurück ob die LETZTE
 * Customer-Message ein Re-Open ohne Text-Anliegen ist.
 *
 * @param msgs  chronologisch (oldest first) Conversation-History
 */
export function analyzeConversationReopen(msgs: MsgRow[]): ConversationReopenAnalysis {
  // Letzte Customer-Message finden
  const customers = msgs.filter(m => m.role === "user");
  if (customers.length === 0) {
    return { isReopenWithoutText: false, reason: "no customer messages", gapHours: null, stalePendingTopics: [] };
  }
  const last = customers[customers.length - 1];
  if (!isNonTextOnly(last)) {
    return { isReopenWithoutText: false, reason: "last customer-msg has text", gapHours: null, stalePendingTopics: [] };
  }

  // Vorherige substantielle Customer-Text-Message (irgendeine, nicht nur die letzte)
  const earlierSubstantial = customers
    .slice(0, -1)
    .filter(hasSubstantialText);
  if (earlierSubstantial.length === 0) {
    // Auch davor keine Text-Message — das ist eine völlig neue Re-Open,
    // kein Re-Aktivierungs-Risiko aus alten Themen.
    return { isReopenWithoutText: false, reason: "no earlier substantial text", gapHours: null, stalePendingTopics: [] };
  }

  const lastSubstantial = earlierSubstantial[earlierSubstantial.length - 1];
  const gapMs = new Date(last.created_at).getTime() - new Date(lastSubstantial.created_at).getTime();
  const gapHours = gapMs / 3600000;

  if (gapMs < REOPEN_GAP_MS) {
    return { isReopenWithoutText: false, reason: `gap only ${gapHours.toFixed(1)}h < 48h`, gapHours, stalePendingTopics: [] };
  }

  // Klassifiziere: was sind die "stale pending topics" die der Bot NICHT
  // reaktivieren soll? — alle Customer-Text-Messages älter als 48h, die
  // konkrete Fragen enthalten könnten (Preis, Verfügbarkeit, Produkt).
  const PENDING_PATTERN = /\b(wie\s+(teuer|viel)|preis|kost|€|euro|verfügbar|haben\s+ihr|habt\s+ihr|bestell|farbe|länge|methode|tapes?|bondings|tressen|clip|wann|gibt\s+es)\b/i;
  const stalePending: string[] = [];
  for (const m of earlierSubstantial) {
    const ageMs = new Date(last.created_at).getTime() - new Date(m.created_at).getTime();
    if (ageMs >= REOPEN_GAP_MS && PENDING_PATTERN.test(m.content || "")) {
      stalePending.push((m.content || "").slice(0, 120));
    }
  }

  return {
    isReopenWithoutText: true,
    reason: `gap ${gapHours.toFixed(1)}h since last substantial text, re-open is attachment/emoji-only`,
    gapHours,
    stalePendingTopics: stalePending,
  };
}

/** Pre-LLM-Hint für den dynamic-Block — verhindert dass Bot alte Themen reaktiviert. */
export function buildConversationReopenHint(analysis: ConversationReopenAnalysis): string {
  if (!analysis.isReopenWithoutText) return "";
  let out = `\n\n## 🔄 CONVERSATION-RE-OPEN ohne Text-Kontext (Pre-LLM, deterministisch)\n`;
  out += `Die Kundin hat nach ${analysis.gapHours?.toFixed(0)}h Pause ohne expliziten Text neu geschrieben (nur Attachment/Emoji/kurze Reaktion).\n\n`;
  if (analysis.stalePendingTopics.length > 0) {
    out += `Im Verlauf sind ALTE Sach-Fragen offen (z.B. Preis-/Verfügbarkeits-Fragen vor >48h):\n`;
    for (const t of analysis.stalePendingTopics.slice(0, 3)) {
      out += `  - "${t.replace(/\n/g, " ")}"\n`;
    }
    out += `\n→ DIESE alten Fragen NICHT automatisch jetzt beantworten. Wenn sie noch relevant sind, muss die Kundin das selbst sagen.\n`;
  }
  out += `\n→ REAGIERE KURZ auf das aktuelle Attachment/die Reaktion (warm, knapp). Stelle EINE fokussierte Klärungsfrage was sie jetzt braucht. Keine Preis-Berechnungen / Produkt-Empfehlungen aus alten Themen reaktivieren. Wenn unklar: \"Hey, magst du mir kurz sagen worum's geht?\"`;
  return out;
}

/**
 * Echo-Schutz: prüft ob die jüngste Bot/MA-Antwort substantiell und ähnlich
 * zu einer NEUEN Antwort wäre. Verhindert Doppel-Sends wie im Bug 2026-05-30
 * (Bot generierte dieselbe Preis+Farb-Antwort zweimal innerhalb 12h auf
 * 2 separate [Foto]-Trigger).
 *
 * Token-basierte Cosine-Similarity über Word-Frequenz, kein Embedding nötig.
 */
export function computeBotAnswerSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const tok = (s: string) =>
    s.toLowerCase()
      .replace(/https?:\/\/\S+/g, " ") // URLs raus (verzerren Ähnlichkeit)
      .replace(/[^a-zäöüß0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 3);
  const ta = tok(a), tb = tok(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const freq = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
    return m;
  };
  const fa = freq(ta), fb = freq(tb);
  let dot = 0, na = 0, nb = 0;
  const all = new Set([...fa.keys(), ...fb.keys()]);
  for (const k of all) {
    const va = fa.get(k) || 0;
    const vb = fb.get(k) || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
