/**
 * Unicode-Sanitization vor Anthropic-API-Calls.
 *
 * Bug 2026-05-30 (Danči): Anthropic warf 400-Error
 *   "no low surrogate in string: line 1 column 123375 (char 123374)"
 * Ursache: irgendwo in der Pipeline wurde ein 4-Byte-Emoji halbiert
 * (z.B. durch unsicheren String-Slice der ein UTF-16 Surrogate-Pair
 * zerteilt). JSON.stringify produziert dann \uD8XX ohne folgendes
 * \uDCXX → Anthropic rejected den Body.
 *
 * UTF-16 Surrogate-Pairs:
 *   - High surrogate: U+D800-U+DBFF (erstes 16-Bit-Wort eines 4-Byte-Chars)
 *   - Low surrogate:  U+DC00-U+DFFF (zweites 16-Bit-Wort)
 *   Beide MÜSSEN zusammen kommen. Lone surrogates sind in JSON nicht valide.
 *
 * Strategie: Lone surrogates durch U+FFFD ("Replacement Character") ersetzen.
 * Falls beide Halbpartner fehlen, ist das Emoji eh kaputt → ein dezenter
 * Hinweis-Char ist besser als ein API-Fehler.
 *
 * Sibling-Sweep: Anwendung in JEDER Anthropic-Call-Site (zentrale Single-
 * Source-of-Truth — neue Routes erben den Schutz beim Import).
 */

/**
 * Ersetzt lone UTF-16 Surrogates in einem String durch U+FFFD.
 * Safe-Pass-Through bei normalen Strings (keine Allocation wenn nichts matched).
 */
export function sanitizeUtf16(s: string | null | undefined): string {
  if (!s) return s ?? "";
  const lonePair = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
  if (!lonePair.test(s)) return s;
  lonePair.lastIndex = 0; // reset wegen test()
  return s.replace(lonePair, "�");
}

/**
 * Rekursive Sanitization für nested Objects/Arrays (z.B. Anthropic messages
 * mit content-blocks, system-blocks, tool_results-content etc.).
 * Returns a NEW object/array — Eingabe wird nicht mutiert.
 *
 * Nur strings werden modifiziert; alles andere wird durchgereicht.
 */
export function sanitizeUtf16Deep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return sanitizeUtf16(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(v => sanitizeUtf16Deep(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeUtf16Deep(v);
    }
    return out as unknown as T;
  }
  return value;
}
