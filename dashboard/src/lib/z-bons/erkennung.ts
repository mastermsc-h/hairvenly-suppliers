// Z-Bon-Erkennung per Claude (Bild/PDF → Kasse, Datum, Tagesumsatz) — server-only.
import Anthropic from "@anthropic-ai/sdk";
import type { ZBonErkennung } from "@/lib/types";

const MODEL = "claude-opus-5-5";

const SYSTEM = `Du liest Fotos und PDFs von Kassen-Tagesabschlüssen (Z-Bons) eines Friseursalons mit Haar-Shop in Bremen (Hairvenly).
Es gibt genau zwei Kassen:
- "shopify_pos": Tagesbericht/Z-Bericht aus Shopify POS (Shop-Kasse). Typisch: "Shopify", "POS", "Z-Bericht"/"Z report"/"Tagesbericht", Verkäufe, Rückerstattungen, Zahlungsarten (Bar, Karte), oft Kassen-/Standortname.
- "nexi": Kassenschnitt/Tagesabschluss vom Nexi-Kartenterminal (Salon, Treatwell). Typisch: "Nexi", "Kassenschnitt", "Tagesabschluss", "Endsumme", Terminal-ID/TID, Kartenarten (girocard, Visa, Mastercard), Belegnummern.
Bilder können Ausschnitte desselben langen Bons sein (von oben nach unten).

Antworte nur mit den Feldern des Schemas:
- ist_z_bon: false, wenn das gar kein Tagesabschluss ist (z. B. einzelner Kundenbeleg, Rechnung, unscharf/unleserlich).
- kasse: "shopify_pos", "nexi" oder "unklar", wenn die Kasse nicht eindeutig erkennbar ist.
- datum: der Geschäftstag des Abschlusses als YYYY-MM-DD (bei Nexi das Datum des Kassenschnitts). null, wenn nicht lesbar. Nie raten.
- umsatz_brutto: Gesamtumsatz des Tages brutto in Euro (Nexi: Gesamt-/Endsumme der Umsätze; Shopify: Gesamtverkäufe inkl. MwSt. bzw. Summe der Zahlungen). null, wenn nicht eindeutig.
- sicherheit: "hoch" nur, wenn Kasse UND Datum klar lesbar sind; sonst "mittel" oder "niedrig".
- hinweis: ein kurzer deutscher Satz, was auffällt (leer, wenn nichts).`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ist_z_bon", "kasse", "datum", "umsatz_brutto", "sicherheit", "hinweis"],
  properties: {
    ist_z_bon: { type: "boolean" },
    kasse: { type: "string", enum: ["shopify_pos", "nexi", "unklar"] },
    datum: { type: ["string", "null"] },
    umsatz_brutto: { type: ["number", "null"] },
    sicherheit: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
    hinweis: { type: "string" },
  },
} as const;

export type ErkennungsInput = { bilder: string[]; pdf?: string | null }; // base64 (JPEG) bzw. PDF

/** Liest den Bon; wirft nie — bei Fehlern kommt sicherheit "niedrig" mit Hinweis zurück. */
export async function erkenneZBon(input: ErkennungsInput, heute: string): Promise<ZBonErkennung> {
  const unklar = (hinweis: string): ZBonErkennung => ({
    ist_z_bon: false,
    kasse: "unklar",
    datum: null,
    umsatz_brutto: null,
    sicherheit: "niedrig",
    hinweis,
  });
  if (!process.env.ANTHROPIC_API_KEY) return unklar("Erkennung nicht eingerichtet");
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdf } });
  for (const b of input.bilder.slice(0, 8)) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b } });
  if (!content.length) return unklar("Keine lesbare Datei");
  content.push({ type: "text", text: `Heute ist ${heute}. Lies diesen Z-Bon.` });

  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal") return unklar("Bon konnte nicht gelesen werden");
    const text = res.content.find((c): c is Anthropic.TextBlock => c.type === "text")?.text ?? "";
    const e = JSON.parse(text) as ZBonErkennung;
    // Plausibilität: Datum muss ein echtes Datum und nicht in der Zukunft sein
    const datumOk = !!e.datum && /^\d{4}-\d{2}-\d{2}$/.test(e.datum) && !Number.isNaN(Date.parse(e.datum)) && e.datum <= heute;
    if (!datumOk) e.datum = null;
    if (e.umsatz_brutto != null && (!Number.isFinite(e.umsatz_brutto) || Math.abs(e.umsatz_brutto) > 1_000_000)) e.umsatz_brutto = null;
    if (!e.datum || e.kasse === "unklar" || !e.ist_z_bon) e.sicherheit = e.sicherheit === "hoch" ? "mittel" : e.sicherheit;
    e.hinweis = String(e.hinweis ?? "").slice(0, 300);
    return e;
  } catch (err) {
    if (err instanceof Anthropic.APIError) return unklar(`Erkennung fehlgeschlagen (${err.status ?? "Netz"})`);
    return unklar("Erkennung fehlgeschlagen");
  }
}
