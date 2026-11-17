/**
 * Lernschleife „Bot-Entwurf vs. echte Team-Antwort" — reine Logik (importfrei,
 * vom Smoke-Test direkt transpiliert). Ausführung: learning.ts.
 *
 * HINTERGRUND (Analyse 17.11.2026): Das Team antwortet in der Instagram-App,
 * Entwürfe im Dashboard sah niemand (9 von 995 freigegeben). Die Entwürfe sind
 * trotzdem wertvoll: Sie zeigen, was der Bot gesagt HÄTTE. Der Vergleich mit
 * der Team-Antwort deckt Wissenslücken auf (Bsp.: Bot „Haare werden vor Ort
 * gewaschen" vs. Team „bitte mit frisch gewaschenen Haaren kommen") und misst,
 * in welchen Kategorien der Bot schon so antwortet wie das Team.
 */

export interface MsgLite {
  role: string;
  content: string | null;
  created_at: string;
  auto_sent?: boolean | null;
  deleted_at?: string | null;
}

export type PairResult =
  | { kind: "team"; text: string; at: string }
  | { kind: "other_reply" }   // Bot (auto) hat stattdessen geantwortet
  | { kind: "none" };         // noch keine Antwort

/** Team-Nachrichten, die innerhalb dieses Fensters nach der ersten folgen, gehören zur selben Antwort. */
export const TEAM_BURST_MS = 10 * 60 * 1000;

/**
 * Erste Antwort nach dem Entwurf finden. Mehrere Team-Nachrichten kurz
 * hintereinander (das Team splittet oft) werden zusammengefasst.
 * `msgs` = Nachrichten der Session NACH dem Entwurf, chronologisch.
 */
export function pairTeamReply(msgs: MsgLite[]): PairResult {
  const live = msgs.filter((m) => !m.deleted_at);
  const first = live.find((m) => m.role !== "user");
  if (!first) return { kind: "none" };
  if (first.role !== "human_agent") return { kind: "other_reply" };
  const t0 = new Date(first.created_at).getTime();
  const parts: string[] = [];
  for (const m of live) {
    const t = new Date(m.created_at).getTime();
    if (t < t0) continue;
    if (t - t0 > TEAM_BURST_MS) break;
    if (m.role === "human_agent" && m.content?.trim()) parts.push(m.content.trim());
  }
  const text = parts.join("\n\n");
  return text ? { kind: "team", text, at: first.created_at } : { kind: "other_reply" };
}

export type Verdict = "same" | "style_only" | "bot_wrong" | "bot_missing" | "not_comparable";
export const VERDICTS: Verdict[] = ["same", "style_only", "bot_wrong", "bot_missing", "not_comparable"];
/** Verdicts, die „Bot hätte inhaltlich wie das Team geantwortet" bedeuten. */
export const AGREEING: Verdict[] = ["same", "style_only"];

export interface LearnedFact {
  kind: "bot_wrong" | "bot_missing";
  fact: string;
  bot_said: string | null;
  faq_question: string;
  faq_answer: string;
}

export interface Comparison {
  verdict: Verdict;
  facts: LearnedFact[];
}

/** Haiku-Antwort robust parsen. Ungültiges → null (Entwurf wird beim nächsten Lauf erneut versucht). */
export function parseComparison(raw: string): Comparison | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: unknown;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const o = j as { verdict?: unknown; facts?: unknown };
  if (typeof o.verdict !== "string" || !VERDICTS.includes(o.verdict as Verdict)) return null;
  const verdict = o.verdict as Verdict;
  const facts: LearnedFact[] = [];
  if (verdict === "bot_wrong" || verdict === "bot_missing") {
    for (const f of Array.isArray(o.facts) ? o.facts.slice(0, 2) : []) {
      const x = f as Record<string, unknown>;
      const kind = x.kind === "bot_wrong" || x.kind === "bot_missing" ? x.kind : verdict;
      const fact = typeof x.fact === "string" ? x.fact.trim() : "";
      const q = typeof x.faq_question === "string" ? x.faq_question.trim() : "";
      const a = typeof x.faq_answer === "string" ? x.faq_answer.trim() : "";
      if (fact.length < 8 || q.length < 8 || a.length < 8) continue;
      facts.push({ kind, fact, bot_said: typeof x.bot_said === "string" && x.bot_said.trim() ? x.bot_said.trim() : null, faq_question: q, faq_answer: a });
    }
  }
  // bot_wrong/bot_missing ohne verwertbaren Fakt ist für uns „nicht vergleichbar genug"
  if ((verdict === "bot_wrong" || verdict === "bot_missing") && facts.length === 0) return { verdict: "not_comparable", facts };
  return { verdict, facts };
}

export const COMPARE_PROMPT = `Du vergleichst einen Chatbot-ENTWURF mit der ECHTEN Antwort des Hairvenly-Teams (Haarverlängerungen, Salon in Bremen + Onlineshop) auf dieselbe Kundennachricht. Ziel: allgemeingültiges Wissen finden, das der Bot NICHT hat oder FALSCH hat.

IGNORIERE: Ton, Emojis, Begrüßung, Länge, Signatur, Reihenfolge; alles, was nur diese eine Kundin betrifft (ihr Name, ihr Termin, ihre Bestellung, „schick mir deine Nummer", „ich schau gleich nach"); Rückfragen statt Antwort; zeitlich begrenzte Aktionen und Rabattcodes (z.B. Hero-Woche, Black Friday, Gewinnspiel); ob eine bestimmte Farbe gerade auf Lager ist (ändert sich täglich).
ZÄHLE NUR: allgemeine Fakten und Regeln, die auch für künftige Kundinnen gelten — Preise und Pakete, Produkt-Eigenschaften, Mengen/Gramm, Abläufe im Salon, Vorbereitung auf Termine, Pflege, Versand, Rückgabe, Rabatte, Richtlinien.

verdict (genau eins):
- "same": Bot sagt inhaltlich dasselbe
- "style_only": nur Formulierung/Ton anders, Fakten gleich
- "bot_wrong": Bot widerspricht dem Team bei einem allgemeinen Fakt
- "bot_missing": Team nennt einen allgemeinen Fakt, den der Bot nicht kennt/nennt und der die Antwort deutlich besser macht
- "not_comparable": Team beantwortet etwas anderes, fragt nur nach Kontaktdaten, Kontext fehlt, oder der Unterschied ist rein fallbezogen

facts (nur bei bot_wrong/bot_missing, max. 2): je {"kind","fact","bot_said","faq_question","faq_answer"}
- fact: der allgemeine Fakt in einem Satz
- bot_said: was der Bot stattdessen sagte (kurz) oder null
- faq_question: typische Kundenfrage dazu
- faq_answer: sachliche Antwort, wie der Bot es künftig sagen soll — ohne Emojis, ohne Kundennamen, nur was das Team tatsächlich gesagt hat (nichts dazuerfinden; Preise nur, wenn das Team sie nennt)

Antworte NUR mit JSON: {"verdict": "...", "facts": [...]}`;

export function buildCompareInput(customer: string, draft: string, team: string): string {
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " …" : s);
  return `KUNDIN (letzte Nachrichten):\n${cut(customer, 1500)}\n\nBOT-ENTWURF:\n${cut(draft, 2000)}\n\nTEAM-ANTWORT:\n${cut(team, 2000)}`;
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
}

/** Gleiche Frage schon als Vorschlag offen/übernommen? (Wortüberschneidung ≥ 60 %) */
export function isDuplicateSuggestion(question: string, existing: string[], threshold = 0.6): boolean {
  const a = tokens(question);
  if (a.size === 0) return false;
  return existing.some((e) => {
    const b = tokens(e);
    if (b.size === 0) return false;
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    return inter / Math.min(a.size, b.size) >= threshold;
  });
}

export interface AgreementRow { category: string; compared: number; agreeing: number; wrong: number; missing: number }

/** Übereinstimmung pro Kategorie (nur vergleichbare Entwürfe zählen). */
export function agreementByCategory(rows: { category: string | null; verdict: Verdict }[]): AgreementRow[] {
  const m = new Map<string, AgreementRow>();
  for (const r of rows) {
    if (r.verdict === "not_comparable") continue;
    const k = r.category || "ohne Kategorie";
    const a = m.get(k) ?? { category: k, compared: 0, agreeing: 0, wrong: 0, missing: 0 };
    a.compared++;
    if (AGREEING.includes(r.verdict)) a.agreeing++;
    if (r.verdict === "bot_wrong") a.wrong++;
    if (r.verdict === "bot_missing") a.missing++;
    m.set(k, a);
  }
  return [...m.values()].sort((a, b) => b.compared - a.compared);
}
