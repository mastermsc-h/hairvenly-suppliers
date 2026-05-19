/**
 * Auto-Lern-Sanitizer: erkennt aus Edit-Diffs welche Wörter Mitarbeiter wiederholt
 * aus Bot-Entwürfen entfernen, und nimmt sie nach N Vorkommen automatisch in den
 * Sanitizer-Filter auf.
 */
import { createServiceClient } from "@/lib/supabase/server";

const AUTO_ACTIVATE_THRESHOLD = 3;

// Deutsche Stop-Words die wir NIE als Filter aktivieren wollen (zu generisch)
const STOP_WORDS = new Set([
  "der", "die", "das", "den", "dem", "des",
  "ein", "eine", "einer", "einem", "einen", "eines",
  "und", "oder", "aber", "doch", "denn", "weil", "als", "wenn",
  "ist", "sind", "war", "waren", "bin", "bist", "wird", "werden", "wurde",
  "hat", "haben", "hatte", "hatten",
  "ich", "du", "er", "sie", "es", "wir", "ihr", "mich", "dich",
  "mein", "dein", "sein", "ihre", "unser",
  "in", "an", "auf", "bei", "mit", "von", "zu", "aus", "für", "über", "um",
  "nicht", "auch", "noch", "schon", "wie", "was", "wo", "wer",
  "ja", "nein", "okay", "ok", "danke", "bitte", "gerne", "klar",
  "sehr", "ganz", "etwas", "alles", "alle", "viel", "wenig", "mehr",
  "hier", "da", "dort", "diese", "dieser", "dieses", "diesem",
]);

/**
 * Findet Wörter die im Original-Bot-Text vorkamen aber im finalen
 * (vom Mitarbeiter editierten) Text NICHT mehr — also bewusst entfernt.
 *
 * Filter:
 * - Nur Wörter mit ≥ 5 Zeichen (kürzere sind oft Stop-Words/Konjugationen)
 * - Keine Stop-Words (Liste oben)
 * - Keine Zahlen/URLs
 */
export function findRemovedWords(original: string, final: string): string[] {
  const norm = (s: string) => s
    .replace(/https?:\/\/\S+/g, " ")   // URLs raus
    .replace(/[^\wäöüÄÖÜß\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 5 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  const origWords = norm(original);
  const finalWords = new Set(norm(final));

  const removedCount = new Map<string, number>();
  for (const w of origWords) {
    if (!finalWords.has(w)) {
      removedCount.set(w, (removedCount.get(w) || 0) + 1);
    }
  }

  // Nur Wörter die KOMPLETT entfernt wurden (nicht in finalText vorkommen)
  return Array.from(removedCount.keys());
}

/**
 * Findet 2-Wort-Phrasen die im Original vorkamen aber im finalen Text nicht mehr.
 * Catcht z.B. "in begrenzter Menge" oder "ich reserviere dir" als zusammenhängende Einheit.
 */
export function findRemovedBigrams(original: string, final: string): string[] {
  const tokenize = (s: string) => s
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\wäöüÄÖÜß\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 0);

  const origTokens = tokenize(original);
  const finalNorm = final
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\wäöüÄÖÜß\s]/g, " ")
    .toLowerCase();

  const bigrams = new Set<string>();
  for (let i = 0; i < origTokens.length - 1; i++) {
    const a = origTokens[i], b = origTokens[i + 1];
    if (a.length < 4 || b.length < 4) continue;  // beide Wörter min 4 Zeichen
    if (STOP_WORDS.has(a) || STOP_WORDS.has(b)) continue;
    const bg = `${a} ${b}`;
    // Phrase ist removed wenn beide Wörter zusammenhängend NICHT im final-Text sind
    if (!finalNorm.includes(bg)) bigrams.add(bg);
  }
  return Array.from(bigrams);
}

/**
 * Vergleicht Original-Bot-Entwurf mit dem finalen (vom Mitarbeiter gesendeten) Text.
 * Trägt entfernte Wörter und Phrasen in chatbot_word_filters ein.
 * Nach N Vorkommen wird der Filter automatisch aktiviert.
 */
export async function recordEditDiff(
  originalBotText: string,
  finalText: string,
  sessionId: string,
): Promise<{ tracked: number; auto_activated: number }> {
  if (!originalBotText.trim() || !finalText.trim()) return { tracked: 0, auto_activated: 0 };
  if (originalBotText.trim() === finalText.trim()) return { tracked: 0, auto_activated: 0 };

  const svc = createServiceClient();
  const removedWords = findRemovedWords(originalBotText, finalText);
  const removedBigrams = findRemovedBigrams(originalBotText, finalText);
  const allPatterns = [...new Set([...removedWords, ...removedBigrams])];

  let tracked = 0;
  let autoActivated = 0;

  for (const pattern of allPatterns) {
    if (!pattern || pattern.length < 4) continue;

    // Existierenden Eintrag holen
    const { data: existing } = await svc
      .from("chatbot_word_filters")
      .select("id, occurrences, active, source_examples")
      .eq("pattern", pattern)
      .maybeSingle();

    if (existing) {
      const newOccurrences = (existing.occurrences || 0) + 1;
      const examples = (existing.source_examples as { session_id: string; at: string }[] | null) || [];
      examples.push({ session_id: sessionId, at: new Date().toISOString() });
      // Halte nur letzte 10 Beispiele
      const trimmed = examples.slice(-10);
      const shouldAutoActivate = !existing.active && newOccurrences >= AUTO_ACTIVATE_THRESHOLD;
      await svc.from("chatbot_word_filters").update({
        occurrences: newOccurrences,
        last_seen_at: new Date().toISOString(),
        source_examples: trimmed,
        ...(shouldAutoActivate ? { active: true, auto_added: true } : {}),
      }).eq("id", existing.id);
      tracked++;
      if (shouldAutoActivate) autoActivated++;
    } else {
      await svc.from("chatbot_word_filters").insert({
        pattern,
        replacement: "",
        occurrences: 1,
        active: false,
        auto_added: false,
        source_examples: [{ session_id: sessionId, at: new Date().toISOString() }],
      });
      tracked++;
    }
  }

  return { tracked, auto_activated: autoActivated };
}

/** Lädt aktive Filter aus der DB — wird vom Sanitizer in respond.ts genutzt */
export async function loadActiveWordFilters(): Promise<{ pattern: string; replacement: string }[]> {
  const svc = createServiceClient();
  const { data } = await svc.from("chatbot_word_filters")
    .select("pattern, replacement")
    .eq("active", true);
  return (data || []).map(f => ({ pattern: f.pattern, replacement: f.replacement || "" }));
}

/** Wendet die geladenen Filter auf einen Text an. Word-boundary-Match für Sicherheit. */
export function applyWordFilters(text: string, filters: { pattern: string; replacement: string }[]): string {
  let result = text;
  for (const f of filters) {
    if (!f.pattern) continue;
    // Word-boundary regex (case-insensitive). Pattern aus DB ist lower-case,
    // Match aber auch Großschreibung am Wortanfang.
    const escaped = f.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    result = result.replace(regex, (matched) => {
      // Erste Buchstabe übernehmen wenn ursprünglich groß war
      if (!f.replacement) return "";
      if (matched[0] === matched[0].toUpperCase() && f.replacement[0]) {
        return f.replacement[0].toUpperCase() + f.replacement.slice(1);
      }
      return f.replacement;
    });
  }
  // Doppelte Leerzeichen aufräumen
  return result.replace(/[ \t]{2,}/g, " ").replace(/\(\s*\)/g, "").trim();
}
