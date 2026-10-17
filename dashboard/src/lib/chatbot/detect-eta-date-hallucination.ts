/**
 * ETA-DATUMS-HALLUZINATIONS-DETEKTOR
 * (Schicht-2-Netz, Geschwister von detect-price-/detect-availability-hallucination)
 *
 * ROOT CAUSE (Bug 16.10.2026, Sarah): Bot nannte "kommt um den 20.08. herum"
 * (überfällig, also Vergangenheit), bestätigte danach auf Nachfrage "nächstes
 * Jahr" und schrieb "20.08.2027" — ein Jahr, das in KEINEM Tool-Ergebnis stand.
 *
 * STRUKTURELLE INVARIANTE: Jedes Liefer-/Ankunftsdatum in der Bot-Antwort
 *   (1) muss durch ein ETA-Feld eines Tool-Ergebnisses (oder den Pre-LLM-
 *       Stock-Hinweis) belegt sein — Tag+Monat, und das Jahr falls genannt;
 *   (2) darf nicht in der Vergangenheit liegen;
 *   (3) "nächstes Jahr" als Ankunftszeitpunkt nur, wenn ein belegtes Datum
 *       tatsächlich im nächsten Jahr liegt.
 * Verletzung → verdächtig → Force-Draft (MA prüft), kein Auto-Senden.
 */

export interface EtaDateHallucinationResult {
  suspicious: boolean;
  reason?: string;
  matchedSnippet?: string;
}

// Wörter, die einen Ankunfts-/Liefer-Kontext anzeigen.
const ARRIVAL_CTX =
  /\b(kommt|kommen|rein(kommen)?|wieder\s+(da|verfügbar|verfuegbar|lieferbar|auf\s*lager)|ankommen|ankunft|eintreffen|liefer(ung|termin|datum)|geliefert|nachschub|verfügbar|verfuegbar|lieferbar|voraussichtlich|erwarte[nt]?)\b/i;
const DATE_RE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?![\d])/g;
const NEXT_YEAR_RE = /\b(nächste[ns]?\s+jahr(es)?|im\s+neuen\s+jahr|anfang\s+(des\s+)?nächsten\s+jahres)\b/i;

function pad(n: string | number): string {
  return String(n).padStart(2, "0");
}

/** Sammelt belegte ETA-Daten aus Tool-JSON (nur ETA-Felder) und Freitext-Hinweisen. */
function collectEvidence(evidence: string[]): { ddmm: Set<string>; iso: Set<string> } {
  const ddmm = new Set<string>();
  const iso = new Set<string>();
  const addFromString = (v: string) => {
    for (const m of v.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
      iso.add(`${m[1]}-${m[2]}-${m[3]}`);
      ddmm.add(`${m[3]}.${m[2]}`);
    }
    for (const m of v.matchAll(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?![\d])/g)) {
      const k = `${pad(m[1])}.${pad(m[2])}`;
      ddmm.add(k);
      if (m[3]) iso.add(`${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`);
    }
  };
  const walk = (node: unknown, key: string) => {
    if (node == null) return;
    if (typeof node === "string") {
      if (/eta|ankunft/i.test(key)) addFromString(node);
      return;
    }
    if (Array.isArray(node)) { node.forEach((n) => walk(n, key)); return; }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k);
    }
  };
  for (const raw of evidence) {
    if (!raw) continue;
    const t = raw.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try { walk(JSON.parse(t), ""); continue; } catch { /* kein JSON → Freitext */ }
    }
    // Freitext (Pre-LLM-Stock-Hinweis): nur Zeilen mit Nachschub-/ETA-Angabe
    for (const line of t.split("\n")) {
      if (/nachschub|kommt\s+ca|eta|ankunft/i.test(line)) addFromString(line);
    }
  }
  return { ddmm, iso };
}

export function detectEtaDateHallucination(
  finalText: string,
  evidence: string[],
  todayIso: string,
): EtaDateHallucinationResult {
  const text = finalText || "";
  const ev = collectEvidence(evidence || []);
  const thisYear = Number(todayIso.slice(0, 4));

  for (const m of text.matchAll(DATE_RE)) {
    const idx = m.index ?? 0;
    const ctx = text.slice(Math.max(0, idx - 90), Math.min(text.length, idx + m[0].length + 40));
    if (!ARRIVAL_CTX.test(ctx)) continue; // kein Liefer-Kontext (z.B. "du hattest am 03.05. bestellt")
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const key = `${pad(d)}.${pad(mo)}`;
    const snippet = ctx.trim().slice(0, 140);
    if (m[3]) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      const iso = `${y}-${pad(mo)}-${pad(d)}`;
      if (iso < todayIso) {
        return { suspicious: true, reason: `Ankunftsdatum ${m[0]} liegt in der Vergangenheit`, matchedSnippet: snippet };
      }
      if (!ev.iso.has(iso)) {
        return { suspicious: true, reason: `Ankunftsdatum ${m[0]} ist durch kein Tool-Ergebnis belegt`, matchedSnippet: snippet };
      }
    } else if (!ev.ddmm.has(key)) {
      return { suspicious: true, reason: `Ankunftsdatum ${m[0]} ist durch kein Tool-Ergebnis belegt`, matchedSnippet: snippet };
    } else {
      // Jahr fehlt, aber belegt: nur unverdächtig, wenn ein belegtes Vorkommen nicht in der Vergangenheit liegt
      const evIsos = [...ev.iso].filter((i) => i.endsWith(`-${pad(mo)}-${pad(d)}`));
      if (evIsos.length > 0 && evIsos.every((i) => i < todayIso)) {
        return { suspicious: true, reason: `Ankunftsdatum ${m[0]} liegt in der Vergangenheit`, matchedSnippet: snippet };
      }
    }
  }

  // "nächstes Jahr" als Ankunftszeitpunkt ohne Beleg. Fenster statt Satz:
  // "ich meinte tatsächlich nächstes Jahr! … kommen voraussichtlich … rein"
  // verteilt die Aussage auf mehrere Sätze (Sarah #2).
  const nextYear = text.match(NEXT_YEAR_RE);
  if (nextYear) {
    const i = nextYear.index ?? 0;
    const win = text.slice(Math.max(0, i - 160), Math.min(text.length, i + nextYear[0].length + 220));
    if (ARRIVAL_CTX.test(win)) {
      const hasNextYearEvidence = [...ev.iso].some((x) => Number(x.slice(0, 4)) > thisYear);
      if (!hasNextYearEvidence) {
        return { suspicious: true, reason: "'nächstes Jahr' als Liefertermin, aber kein belegtes Datum im nächsten Jahr", matchedSnippet: win.trim().slice(0, 140) };
      }
    }
  }
  return { suspicious: false };
}
