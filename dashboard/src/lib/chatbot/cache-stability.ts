/**
 * CACHE-STABILITÄT — entkoppelt das LERNEN (neue FAQs/Trainings) vom
 * Prompt-Cache (Schritt B der Kosten-Architektur, 09.06.2026).
 *
 * Problem (gemessen): 66% der respond-Kosten waren CACHE-SCHREIBVORGÄNGE,
 * weil jede neue gepinnte/Core-FAQ und jedes neue gepinnte Training den
 * stabilen 40k-Block sofort veränderte → Cache-Invalidierung für ALLE
 * Sessions, ~13×/Tag (195 FAQs + 206 Trainings in 30 Tagen).
 *
 * Lösung: Tages-Cutoff (UTC-Mitternacht, deterministisch).
 *   - Inhalte, die VOR heute zuletzt geändert wurden → "konsolidiert"
 *     → stabiler Cache-Block (ändert sich nur 1×/Tag, beim Tageswechsel).
 *   - Inhalte von HEUTE (neu erstellt ODER editiert) → "frisch"
 *     → variabler Block (uncached, aber klein) — SOFORT im Prompt wirksam,
 *     nur eben ohne den Cache zu sprengen.
 *
 * INVARIANTE (per Smoke-Test abgesichert): consolidated + fresh = alle Rows.
 * Es geht NIE Inhalt verloren — nur die Cache-Platzierung ändert sich.
 * Qualität bleibt identisch: das LLM sieht denselben Inhalt im selben Prompt.
 */

/** Deterministischer Tages-Cutoff: heutige UTC-Mitternacht als ISO-String.
 *  Über den ganzen Tag identisch → der stabile Block bleibt byte-gleich. */
export function stableCutoffIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10) + "T00:00:00.000Z";
}

export interface TimestampedRow {
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Teilt Rows in konsolidiert (→ stable Cache-Block) und frisch (→ variabler
 * Block). Frisch = heute erstellt ODER heute editiert (updated_at zählt,
 * damit ein Edit einer alten FAQ den stabilen Block nicht mehrfach am Tag
 * verändert — der Inhalt wandert für den Rest des Tages in den variablen Block).
 * Rows ohne Timestamp → konsolidiert (deterministisch, ändern sich nicht).
 */
export function splitByCacheCutoff<T extends TimestampedRow>(
  rows: T[],
  cutoffIso: string,
): { consolidated: T[]; fresh: T[] } {
  const consolidated: T[] = [];
  const fresh: T[] = [];
  for (const r of rows) {
    const ts = r.updated_at || r.created_at || "";
    if (ts && ts >= cutoffIso) fresh.push(r);
    else consolidated.push(r);
  }
  return { consolidated, fresh };
}
