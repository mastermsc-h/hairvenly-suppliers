/**
 * FACT-VERIFIER — Schicht 2 der Anti-Halluzinations-Architektur.
 * (Design: CHATBOT_ANTI_HALLUCINATION.md)
 *
 * Statt N Einzel-Regexe für je EINE erfundene Aussage ("Preis ist gleich",
 * "jeden Moment", ...): EIN semantischer Prüf-Pass, der JEDE Tatsachen-
 * behauptung gegen die tatsächlich abgerufenen Daten hält.
 *
 * Input:  Bot-Antwort + die in diesem Turn abgerufenen Tool-Ergebnisse.
 * Frage:  "Welche Faktenbehauptung lässt sich NICHT aus diesen Daten belegen?"
 * Output: Liste unbelegter Behauptungen → Caller entscheidet (Force-Draft).
 *
 * WICHTIG — was NICHT geprüft wird (sonst False-Positives):
 *  - Smalltalk, Begrüßung, Empathie ("verstehe deine Sorge")
 *  - subjektive Beratung ("der Look würde dir stehen") — Geschmack, kein Fakt
 *  - allgemein bekannte Tatsachen ("Haare wachsen nach")
 * Geprüft werden NUR überprüfbare GESCHÄFTS-Fakten: Preise, Verfügbarkeit/
 * Lager, Längen/Methoden, Lieferdaten, Haltbarkeit, Maße/Mengen.
 *
 * Dieses Modul ist BEWUSST nebenwirkungsfrei: es ruft Haiku auf und gibt ein
 * Urteil zurück. Ob daraus ein Force-Draft wird, entscheidet der Caller. So
 * kann es im Shadow-Mode (nur loggen) ODER scharf (Force-Draft) laufen.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";

export interface FactClaim {
  claim: string;        // die unbelegte Behauptung (Zitat/Paraphrase)
  category: string;     // preis | verfuegbarkeit | laenge | lieferdatum | haltbarkeit | menge | sonstiges
}

export interface FactVerifierResult {
  /** true = mind. eine Faktenbehauptung ist NICHT durch Daten belegt */
  hasUnsupported: boolean;
  unsupported: FactClaim[];
  /** roher Haiku-Output (für Debug/Logging) */
  raw?: string;
  /** Verifier konnte nicht laufen (Fehler) → Caller soll fail-open behandeln */
  errored?: boolean;
}

/**
 * @param botAnswer    die fertige Bot-Antwort (finalText)
 * @param toolResults  Tool-Ergebnisse dieses Turns (JSON-Strings o.ä.)
 * @param extraFacts   optional: zusätzliche verlässliche Stammdaten als Text
 */
export async function verifyFacts(
  botAnswer: string,
  toolResults: Array<{ name?: string; content: string }>,
  extraFacts: string = "",
): Promise<FactVerifierResult> {
  const text = (botAnswer || "").trim();
  if (!text) return { hasUnsupported: false, unsupported: [] };

  const toolBlock = (toolResults || [])
    .map((t, i) => `[Tool ${i + 1}${t.name ? " " + t.name : ""}]\n${(t.content || "").slice(0, 2000)}`)
    .join("\n\n") || "(in diesem Turn wurden KEINE Tools aufgerufen)";

  const system = `Du bist ein strenger Faktenprüfer für einen Haar-Extension-Shop (Hairvenly).
Du bekommst (A) eine Bot-Antwort an eine Kundin und (B) die Daten, die dem Bot in diesem Gespräch zur Verfügung standen (Tool-Ergebnisse + Stammdaten).

Deine Aufgabe: Finde JEDE ÜBERPRÜFBARE GESCHÄFTS-Tatsachenbehauptung in der Bot-Antwort, die sich NICHT aus den bereitgestellten Daten belegen lässt.

PRÜFE NUR diese Fakten-Kategorien:
- preis (konkrete ODER vergleichende Preisaussagen, z.B. "kostet 119€", "beide gleich teuer", "günstiger")
- verfuegbarkeit (auf Lager / ausverkauft / unterwegs)
- laenge / methode (welche Länge/Methode es in welcher Linie gibt)
- lieferdatum / eta (konkrete Termine)
- haltbarkeit (z.B. "hält 6-8 Monate")
- menge / mass (Packungsgrößen, Gramm, Strähnenzahl)

PRÜFE NICHT (das ist KEINE Halluzination):
- Begrüßung, Empathie, Smalltalk, Emojis
- subjektive Beratung/Geschmack ("würde dir stehen", "schöner Look")
- Rückfragen ("welche Länge schwebt dir vor?")
- allgemein bekannte Tatsachen über Haare/Pflege
- Aussagen, die durch die Daten GEDECKT sind

Eine Behauptung ist "nicht belegt", wenn die Daten sie nicht stützen ODER ihr widersprechen. Wenn in diesem Turn KEINE Tools aufgerufen wurden, sind ALLE konkreten Geschäfts-Fakten unbelegt (außer es sind triviale, allgemeine Aussagen).

Antworte als striktes JSON, nichts sonst:
{"unsupported":[{"claim":"<kurzes Zitat/Paraphrase>","category":"<kategorie>"}]}
Wenn alles belegt/unkritisch ist: {"unsupported":[]}`;

  const user = `=== (A) BOT-ANTWORT ===\n${text}\n\n=== (B) VERFÜGBARE DATEN ===\n${toolBlock}${extraFacts ? "\n\n=== STAMMDATEN ===\n" + extraFacts : ""}`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    });
    const out = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text).join("").trim();

    let parsed: { unsupported?: FactClaim[] } | null = null;
    const jsonMatch = out.match(/\{[\s\S]*\}/);
    if (jsonMatch) { try { parsed = JSON.parse(jsonMatch[0]); } catch { /* ignore */ } }

    const unsupported = Array.isArray(parsed?.unsupported) ? parsed!.unsupported! : [];
    return {
      hasUnsupported: unsupported.length > 0,
      unsupported,
      raw: out,
    };
  } catch (e) {
    console.warn("[fact-verifier] failed:", (e as Error).message);
    // Fail-open: bei Verifier-Fehler NICHT blockieren (Caller behandelt es).
    return { hasUnsupported: false, unsupported: [], errored: true };
  }
}
