/**
 * Pre-LLM Color-Code Injector — strukturelle Lösung gegen
 * "Bot sagt 'kenne ich nicht' zu existierenden Farbcodes".
 *
 * Architektur-Prinzip (siehe CHATBOT_ARCHITECTURE.md §1.1):
 *   Pre-LLM-Inject statt LLM-Decide.
 *
 * Ablauf:
 *   1. detectColorCodes() — Regex auf Color-Code-Muster in Customer-Message
 *   2. lookupColorCodes() — DB-Query in product_colors (case-insensitive)
 *   3. buildColorCodeHint() — System-Block bauen mit Fakten
 *
 * Das Ergebnis wird in respond.ts als System-Block VOR dem LLM-Call
 * in den Prompt gepackt. Damit hat der Bot die Wahrheit bereits im
 * Kontext und KANN keine Halluzination "kenne ich nicht" mehr erzeugen.
 */
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Tokens, die wie Color-Codes aussehen aber Einheiten/Abkürzungen sind.
 * Werden aus den Detection-Matches gefiltert.
 */
const BLOCKLIST = new Set<string>([
  // Einheiten
  "CM", "MM", "KG", "GR", "ML", "CL", "KM", "G", "L",
  "CM2", "MM2", "CM3", "MM3",
  // Währungen/Codes
  "EUR", "USD", "CHF", "GBP", "JPY",
  // Allg. Abkürzungen
  "OK", "USA", "USB", "ID", "OK", "AGB", "WC", "WC2", "UV", "PS", "PR",
  "AM", "PM", "AGB", "MWST", "MWST",
  // Hairvenly-Begriffe, die kein Code sind
  "65CM", "55CM", "45CM", "85CM", "60CM", "50CM", "70CM", "75CM", "80CM",
]);

/**
 * Regex-Muster für Hairvenly-Farbcodes — abgeleitet aus echten DB-Codes:
 *   5P18A, 2T18A, 5T18A, 1A, 6B, P14, MR2, plus "Slash"-Form 4/27, 27/613.
 *
 * Bedingung: muss mind. 1 Ziffer UND 1 Buchstabe enthalten (sonst kein Code).
 */
const CODE_PATTERN = /\b(?:[0-9]{1,2}[A-Z]{1,2}[0-9]{0,3}[A-Z]?|[0-9]{1,2}\/[0-9]{1,3}|P[0-9]{1,3}[A-Z]?|MR[0-9]{1,3}[A-Z]?)\b/g;

export function detectColorCodes(text: string): string[] {
  if (!text || text.length < 2) return [];
  const upper = text.toUpperCase();
  const matches = new Set<string>();
  let m: RegExpExecArray | null;
  // re-init lastIndex defensively
  CODE_PATTERN.lastIndex = 0;
  while ((m = CODE_PATTERN.exec(upper)) !== null) {
    const code = m[0];
    if (BLOCKLIST.has(code)) continue;
    if (code.length < 2 || code.length > 8) continue;
    // Erlaubt: (a) Buchstabe+Ziffer-Mix (5P18A, P14, MR2) ODER (b) Slash-Format (4/27, 27/613)
    const hasLetter = /[A-Z]/.test(code);
    const hasDigit = /[0-9]/.test(code);
    const isSlashFormat = /\//.test(code) && hasDigit;
    if (!isSlashFormat && (!hasLetter || !hasDigit)) continue;
    matches.add(code);
  }
  return Array.from(matches);
}

export type ColorCodeMatch = {
  code: string;
  found: boolean;
  variants?: Array<{ method: string; line: string; length: string }>;
};

/**
 * DB-Lookup für jeden detected Code.
 * Case-insensitive via ILIKE %code%.
 */
export async function lookupColorCodes(codes: string[]): Promise<ColorCodeMatch[]> {
  if (codes.length === 0) return [];
  const svc = createServiceClient();
  const results: ColorCodeMatch[] = [];
  for (const code of codes) {
    const { data, error } = await svc
      .from("product_colors")
      .select(`
        name_hairvenly,
        name_shopify,
        shopify_url,
        length:product_lengths!product_colors_length_id_fkey(
          value, unit,
          method:product_methods!product_lengths_method_id_fkey(
            name,
            supplier:suppliers!product_methods_supplier_id_fkey(name)
          )
        )
      `)
      .ilike("name_hairvenly", `%${code}%`)
      .eq("bot_active", true)
      .limit(25);
    if (error) {
      console.warn(`[color-code-lookup] DB error for ${code}:`, error.message);
      continue;
    }
    if (!data || data.length === 0) {
      results.push({ code, found: false });
      continue;
    }
    type Row = {
      name_hairvenly: string;
      length?: { value?: number; unit?: string; method?: { name?: string; supplier?: { name?: string } | null } | null } | null;
    };
    const variants = (data as unknown as Row[]).map((r) => {
      const supName = (r.length?.method?.supplier?.name || "").toLowerCase();
      const line =
        supName.includes("amanda")
          ? "Russisch glatt"
          : supName.includes("eyfel") || supName.includes("ebru")
          ? "Usbekisch wellig"
          : supName.includes("china")
          ? "China-Linie"
          : "Sonstige";
      const methodName = r.length?.method?.name || "—";
      const lengthVal = r.length?.value ? `${r.length.value}${r.length.unit || "cm"}` : "";
      return { method: methodName, line, length: lengthVal };
    });
    results.push({ code, found: true, variants });
  }
  return results;
}

/**
 * System-Hint-Text bauen. Wird in den Prompt eingebaut.
 * Returns null wenn nichts zu sagen ist.
 */
export function buildColorCodeHint(matches: ColorCodeMatch[]): string | null {
  if (matches.length === 0) return null;
  const lines: string[] = [];
  lines.push("## 🎨 FARBCODE-LOOKUP (deterministisch aus DB — KEINE Halluzination möglich)");
  lines.push("");
  lines.push("Die Kundin hat in ihrer Message folgende Farbcode-ähnliche Tokens erwähnt. Dies sind die VERIFIZIERTEN Fakten aus product_colors:");
  for (const m of matches) {
    if (m.found && m.variants && m.variants.length > 0) {
      lines.push("");
      lines.push(`**${m.code}** → EXISTIERT in unserem Katalog (${m.variants.length} Varianten):`);
      // Gruppieren nach Linie, dann Methode+Länge
      const byLine = new Map<string, Set<string>>();
      for (const v of m.variants) {
        if (!byLine.has(v.line)) byLine.set(v.line, new Set());
        byLine.get(v.line)!.add(`${v.method} ${v.length}`.trim());
      }
      for (const [line, vars] of byLine) {
        lines.push(`  - ${line}: ${Array.from(vars).join(", ")}`);
      }
    } else {
      lines.push("");
      lines.push(`**${m.code}** → NICHT im aktiven Katalog gefunden. → Frage die Kundin freundlich, wo sie den Code gesehen hat. NIEMALS hart behaupten "kenne ich nicht" — vielleicht ist es eine ältere Bezeichnung oder ein Tippfehler.`);
    }
  }
  lines.push("");
  lines.push("**HARTE REGEL:** Du DARFST NICHT behaupten, einen oben als EXISTIEREND gelisteten Code nicht zu kennen. Die Fakten oben sind verbindlich.");
  return lines.join("\n");
}

/**
 * One-Shot-Helper: aus Customer-Text → System-Hint-String (oder null).
 */
export async function buildColorCodeContextHint(customerText: string): Promise<string | null> {
  const codes = detectColorCodes(customerText);
  if (codes.length === 0) return null;
  const matches = await lookupColorCodes(codes);
  return buildColorCodeHint(matches);
}
