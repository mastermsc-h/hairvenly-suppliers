/**
 * Output-Sanitizer für Bot-Antworten.
 *
 * WICHTIG: diese Funktionen werden SOWOHL aus respond.ts (initialer Bot-Call)
 * ALS AUCH aus refine.ts (Mitarbeiter klickt "Neu generieren") aufgerufen.
 * Sonst greifen die Schutzregeln nur beim ersten Run, nicht beim Refine.
 *
 * Die kontextfreien Sanitizer (kein DB-Lookup, kein Tool-Result-Bedarf) sind
 * hier zentralisiert. Kontextsensitive Sanitizer (ETA-Linien-Validator,
 * Methoden×Linien gegen DB, Ephemeral-Halluzination) bleiben in respond.ts,
 * weil sie Zugriff auf msgs/catalog/tool_results brauchen.
 */
import { getBusinessHoursContext } from "./business-hours";

/**
 * Selbstreferenzielle Klammer-Disclaimer am Ende entfernen.
 *   "_(Kurz: die exakte Längen-Methoden-Kombi muss ich dir nochmal
 *      sauber benennen — schreibe dir die Optionen gleich mit der
 *      Kollegin durch.)_"
 */
export function stripSelfReferentialDisclaimer(text: string): string {
  const patterns: RegExp[] = [
    // Markdown-Italic-Klammer
    /_\(\s*(kurz|hinweis|p\.?s\.?|nb)[:\s][^()]{0,400}\)_/gi,
    // Klammer ohne Italic
    /(?:^|\n)\s*\(\s*(kurz|hinweis|p\.?s\.?|nb)[:\s][^()]{0,400}\)\s*/gi,
    // Ohne Klammern
    /(?:^|\n)\s*kurz:?\s+die\s+(exakte|genauen?|richtige[rn]?|finalen?)[^.\n]{0,250}\b(kolleg|stylistin|abklären|abstimmen|durchsprechen|nachfragen|nochmal|noch\s+mal)\b[^.\n]{0,150}\.?/gi,
    // PS:-Variante
    /(?:^|\n)\s*p\.?\s*s\.?:?\s+[^.\n]{0,200}\b(kolleg|stylistin|abklären|abstimmen|durchsprechen)\b[^.\n]{0,150}\.?/gi,
    // Italic ohne Klammer
    /(?:^|\n)\s*_kurz:?\s+[^_\n]{0,300}\b(kolleg|stylistin|abklären|abstimmen|durchsprechen|nochmal|noch\s+mal)\b[^_\n]{0,150}_/gi,
  ];
  let out = text;
  for (const p of patterns) out = out.replace(p, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Proaktive Extra-Foto/Video-Angebote rausstrippen.
 * Nur erlaubt, wenn die Kundin EXPLIZIT nach Fotos/Videos gefragt hat
 * (Frage-Verb + Medien-Wort in den letzten Customer-Messages).
 */
export function stripProactivePhotoOffer(text: string, customerAskedForPhotos: boolean): string {
  if (customerAskedForPhotos) return text; // reaktive Antwort OK

  const patterns: RegExp[] = [
    /(^|\n)[^\n]*\b(wir|ich)\b[^\n]{0,40}\b(können|kann|könnten|machen|mache|schicken|sende|filmen)\b[^\n]{0,80}\b(extra |zusätzliche? )?(fotos? (oder|und) videos?|videos? (oder|und) fotos?|extra fotos?|extra videos?)\b[^\n]*(\n|$)/gi,
    /(^|\n)[^\n]*\bmagst\s+du[^\n]{0,80}\b(extra\s+)?(fotos?|videos?|bilder)\b[^\n]{0,40}\b(schickt?|schicken|sendet?|senden|machen?|aufnimmt)\b[^\n]*(\n|$)/gi,
    /(^|\n)[^\n]*\bich (kann|könnte) dir (ein |noch ein )?(video|extra foto)[^\n]*(\n|$)/gi,
    /(^|\n)[^\n]*\bwir filmen (dir |die )[^\n]*(\n|$)/gi,
  ];
  let out = text;
  for (const p of patterns) out = out.replace(p, "\n");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Erkennt + strippt die FALSCHE Behauptung "wir können dir aus technischen
 * Gründen hier keine Fotos/Videos schicken" (oder Varianten). Diese Aussage
 * ist eine Lüge — wir KÖNNEN sehr wohl Fotos/Videos via IG/WhatsApp senden,
 * die MA macht das einfach manuell. Der Bot soll sich nicht selber raus-
 * reden, wenn die Kundin explizit nach Produktbildern fragt.
 *
 * User-Bug 2026-05-28: "wir hatten dieses thema schon! wenn der kunde
 * explizit nach weiteren fotos oder videos fragt, dann können wir das
 * natürlich schicken. was für aus technischen gründen nicht schicken
 * können — was soll dieser schwachsinn?"
 *
 * Returns: { text, stripped } — stripped=true wenn etwas entfernt wurde,
 * damit der Caller `needsManualReview` setzen kann (= Draft statt Auto-Send,
 * MA korrigiert die Antwort).
 */
/**
 * Erkennt halluzinierte Kontakt-Infos im Bot-Output — KEIN Stripping,
 * nur Force-Draft-Signal (zero false-positives, MA entscheidet).
 *
 * Bug-Pattern: LLM kippt die WhatsApp-Nummer mitten in einen
 * unpassenden Satz, z.B. "Länge etwaWhatsApp 0173 8000865cm)?".
 * Triggert wenn:
 *   - WhatsApp-Nummer (0173 8000865 in 3 Varianten) im Output vorkommt
 *   - UND der Satz, in dem sie auftaucht, KEINEN Kontakt-Trigger davor
 *     hat ("WhatsApp", "Tel:", "ruf an", "erreichst du", "schreib uns",
 *     "Nummer", "kontaktiere")
 *
 * Wir strippen NICHT (Halluzinations-Position ist schwer zu trennen
 * vom legitimen Text). Stattdessen melden wir es als suspicious →
 * Caller setzt needsManualReview = true, MA prüft.
 *
 * User-Bug 2026-05-29 (Lauri).
 */
export function detectStrandedContactInfo(text: string): { suspicious: boolean; matchedSnippet: string | null } {
  // Bewusst SIMPEL: jede Erwähnung der WhatsApp-Nummer im Bot-Output
  // löst Force-Draft aus. Begründung: die Nummer ist in der täglichen
  // Praxis fast nie wirklich Teil einer guten Bot-Antwort — die MA
  // verweist normalerweise von selbst. False-Positive (= MA sieht Draft
  // statt Auto-Send) ist ein leichtes Inconvenience, kein Bug.
  const numberRe = /\b(?:\+?49\s*173\s*8000865|0173\s*8000865|01738000865)\b/i;
  const m = text.match(numberRe);
  if (!m || m.index === undefined) return { suspicious: false, matchedSnippet: null };
  const snipStart = Math.max(0, m.index - 30);
  const snipEnd = Math.min(text.length, m.index + m[0].length + 30);
  return { suspicious: true, matchedSnippet: text.slice(snipStart, snipEnd).trim() };
}

/**
 * Strippt verstrandete WhatsApp-Nummern aus Halluzinationen.
 *
 * Bug 2026-05-30 (Britt): Bot generierte
 *   "+WhatsApp 0173 8000865Unsere Kollegin meldet sich Montag früh..."
 * Die Nummer klemmt OHNE Trennzeichen direkt vor "Unsere" — eindeutig
 * halluziniert. detectStrandedContactInfo setzt zwar Force-Draft, aber
 * die kaputte Phrase bleibt im Draft.
 *
 * Strip-Pattern: WhatsApp-Nummer (optional mit "WhatsApp"/"+WhatsApp"
 * Prefix oder "via WhatsApp") DIREKT vor einem Wort-Zeichen ohne
 * Trennung. Sehr safe — false-positive nur wenn jemand bewusst die
 * Nummer in einen Wort-Mash schreibt, was unrealistisch ist.
 *
 * Beispiele die gestrippt werden:
 *   "+WhatsApp 0173 8000865Unsere"           → "Unsere"
 *   "via WhatsApp 0173 8000865Schreib"       → "Schreib"
 *   "0173 8000865Hallo"                       → "Hallo"
 * Beispiele die NICHT gestrippt werden:
 *   "WhatsApp 0173 8000865 — schneller"      (legitim, Space davor)
 *   "Schreib uns an 0173 8000865."            (legitim, Punkt danach)
 */
export function stripStrandedWhatsappNumber(text: string): { text: string; stripped: boolean } {
  if (!text) return { text, stripped: false };
  // Pattern: optional Prefix "+", "WhatsApp ", "via WhatsApp ", "über WhatsApp "
  //          Telefonnummer-Variante
  //          DIREKT gefolgt von einem Buchstaben (kein Space/Punkt/Newline/Komma)
  const stranded = /(?:\s*\+|\s*(?:via|über|auf)?\s*WhatsApp\s+)?(?:\+?49\s*173\s*8000865|0173\s*8000865|01738000865)(?=[A-Za-zÄÖÜäöüß])/gi;
  let stripped = false;
  let out = text.replace(stranded, () => {
    stripped = true;
    return "";
  });
  if (stripped) {
    console.warn("[sanitizer] stripStrandedWhatsappNumber: verstrandete WhatsApp-Nummer entfernt");
    // Aufräumen:
    //   - einsame "+" am Zeilenanfang oder direkt vor einem Buchstaben → weg
    //   - doppelte Spaces / führende Spaces in Zeilen
    //   - "uns" + Wort-Mash ohne Space zwischenfügen (Schreib unsBis → Schreib uns. Bis)
    out = out
      .replace(/(^|\n)\s*\+\s*(?=[A-Za-zÄÖÜäöüß])/g, "$1")
      .replace(/\s\+(?=[A-Za-zÄÖÜäöüß])/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .trim();
  }
  return { text: out, stripped };
}

export function stripFalseMediaLimitation(text: string): { text: string; stripped: boolean } {
  // Pattern: kombiniert "aus technischen Gründen" / "hier" / "leider"
  // mit Medien-Versand-Negation. Sehr spezifisch, damit echte Aussagen
  // (z.B. "wir können hier nicht den Termin bestätigen" → ok) durchgehen.
  const patterns: RegExp[] = [
    // "wir können dir aus technischen Gründen hier keine Videos/Fotos schicken"
    /(^|\n)[^\n]*\b(?:leider\s+)?(?:können\s+wir|kann\s+ich|kann\s+(?:dir|euch))\b[^\n]{0,80}\b(?:aus\s+technischen\s+gründen|technisch|hier)\b[^\n]{0,80}\b(?:keine?|leider\s+keine?)\b\s*(fotos?|videos?|bilder|medien)\b[^\n]*(\n|$)/gi,
    // "das ist hier nicht möglich" + Medien-Bezug in nahem Kontext
    /(^|\n)[^\n]*\b(?:das|leider)\b[^\n]{0,30}\b(?:ist\s+(?:hier\s+)?nicht\s+möglich|nicht\s+möglich\s+hier|geht\s+(?:hier\s+)?nicht)\b[^\n]{0,50}\b(fotos?|videos?|bilder)\b[^\n]*(\n|$)/gi,
    // "wir haben keine Möglichkeit … Fotos/Videos zu schicken"
    /(^|\n)[^\n]*\b(?:wir|ich)\b[^\n]{0,30}\b(?:haben?|hätten)\s+(?:leider\s+)?keine?\s+(?:möglichkeit|option)\b[^\n]{0,80}\b(fotos?|videos?|bilder)\b[^\n]*(\n|$)/gi,
    // "leider können wir hier keine Fotos/Videos"
    /(^|\n)[^\n]*\bleider\b[^\n]{0,40}\b(?:können\s+wir|kann\s+ich)\b[^\n]{0,30}\bhier\b[^\n]{0,30}\b(?:keine?)\b\s*(fotos?|videos?|bilder)\b[^\n]*(\n|$)/gi,
    // FALSCH-Behauptung: Videos auf Shopify-Produktseiten (es gibt keine!)
    // "Auf den Produktseiten sind Videos" / "im Shop sind Videos" / "Produktseite hat ein Video"
    /(^|\n)[^\n]*\b(?:auf\s+(?:der|den)\s+produktseiten?|im\s+shop|auf\s+den\s+shop[\s-]?seiten?|produktseiten?[^\n]{0,20}(?:hat|haben|enthält|enthalten|zeigen?|zeigt))\b[^\n]{0,120}\bvideo[s]?\b[^\n]*(\n|$)/gi,
    // "siehst du die Farbe in Bewegung" / "wie die Farbe in echt wirkt" mit Shop/Produkt-Bezug
    /(^|\n)[^\n]*\b(?:siehst|sieht\s+man)\s+du?\b[^\n]{0,40}\b(?:farbe[n]?|haar[e]?)\b[^\n]{0,40}\bin\s+(?:bewegung|echt|real)\b[^\n]*(\n|$)/gi,
    // "Dort siehst du jeweils, wie die Farben im echten Licht wirken" — Shop-Werbung mit Medien-Hint
    /(^|\n)[^\n]*\bdort\s+(?:siehst|sieht\s+man)\b[^\n]{0,60}\b(?:farbe[n]?|im\s+(?:echten\s+)?licht|in\s+bewegung)\b[^\n]*(\n|$)/gi,
  ];
  let out = text;
  let strippedAny = false;
  for (const p of patterns) {
    const before = out;
    out = out.replace(p, "\n");
    if (out !== before) strippedAny = true;
  }
  if (strippedAny) {
    console.warn(`[sanitizer] FALSE-MEDIA-LIMITATION stripped — bot behauptete fälschlich "können keine Fotos/Videos schicken"`);
  }
  return {
    text: out.replace(/\n{3,}/g, "\n\n").trim(),
    stripped: strippedAny,
  };
}

/**
 * Lieferanten-Namen (Amanda, Eyfel, Ebru, China) durch Haarqualität ersetzen.
 */
export function scrubSupplierNames(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bEyfel[ -]?Ebru\b/gi, "Usbekisch wellig"],
    [/\bEyfel[ -]?(Tapes?|Bondings?|Tressen|Clip[ -]?Ins?|Genius[ -]?Weft|Ponytails?)\b/gi, "Usbekisch wellige $1"],
    [/\bAmanda[ -]?(Tapes?|Bondings?|Tressen|Clip[ -]?Ins?|Genius[ -]?Weft|Ponytails?|Mini[ -]?Tapes?|Standard[ -]?Tapes?)\b/gi, "Russisch glatte $1"],
    [/\bChina[ -]?(Tapes?|Bondings?|Tressen|Clip[ -]?Ins?|Linie)\b/gi, "$1"],
    [/\b(bei|von|aus|unsere?n?)\s+Amanda\b/gi, "$1 Russisch glatt"],
    [/\b(bei|von|aus|unsere?n?)\s+Eyfel\b/gi, "$1 Usbekisch wellig"],
    [/\(Amanda\)/g, "(Russisch glatt)"],
    [/\(Eyfel(?:[ -]?Ebru)?\)/gi, "(Usbekisch wellig)"],
    [/\bAmanda\b/g, "unsere Russisch-glatt-Linie"],
    [/\bEyfel(?:[ -]?Ebru)?\b/gi, "unsere Usbekisch-wellig-Linie"],
    [/\bEbru\b/g, ""],
  ];
  let out = text;
  for (const [re, repl] of replacements) out = out.replace(re, repl);
  return out.replace(/  +/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * "morgen früh" am Freitag/Samstag → "Montag früh" (sonst Salon ist Sa/So zu).
 */
export function scrubWeekendTrap(text: string): string {
  const biz = getBusinessHoursContext();
  if (biz.todayWeekday !== "Freitag" && biz.todayWeekday !== "Samstag") return text;
  const replacements: Array<[RegExp, string]> = [
    [/\bmorgen\s+früh\s+ab\s+10(\s*uhr)?\b/gi, "Montag früh ab 10 Uhr"],
    [/\bmorgen\s+früh\s+wieder\s+im\s+salon\b/gi, "Montag früh wieder im Salon"],
    [/\bmorgen\s+früh\b/gi, "Montag früh"],
    [/\bmorgen\s+um\s+10(\s*uhr)?\b/gi, "Montag ab 10 Uhr"],
    [/\bmorgen\s+wieder\s+(erreichbar|im\s+salon|im\s+studio|da)/gi, "Montag wieder $1"],
    [/\bmorgen\s+ab\s+10\b/gi, "Montag ab 10 Uhr"],
    [/\bab\s+morgen\b/gi, "ab Montag"],
  ];
  let out = text;
  for (const [re, repl] of replacements) out = out.replace(re, repl);
  return out;
}

/**
 * "Kollegin meldet sich gleich" außerhalb Geschäftszeit → nächste Öffnung.
 */
export function scrubClosedHandover(text: string): string {
  const biz = getBusinessHoursContext();
  if (biz.status === "open_wide") return text;
  const replacementLabel = biz.status === "closed"
    ? biz.nextOpenLabel
    : `noch heute, spätestens ${biz.nextOpenLabel}`;
  const replacements: Array<[RegExp, string]> = [
    [/\b(meine\s+|eine\s+|unsere\s+)?(kollegin|farb-?expertin|stylistin|mitarbeiterin)\s+(meldet|schreibt|kommt|antwortet|kümmert)\s+sich\s+(gleich|in\s+kürze|sofort|kurz\s+(durch|gleich)|gleich\s+(durch|bei\s+dir))/gi,
     `$1$2 meldet sich ${replacementLabel}`],
    [/\b(schreibe|melde|sage)\s+(dir|euch)\s+gleich(\s+mit\s+der\s+kollegin\s+durch)?/gi,
     `melde mich ${replacementLabel} bei dir`],
    [/\b(meldet\s+sich\s+(gleich|in\s+kürze|kurz)\s+bei\s+dir)/gi,
     `meldet sich ${replacementLabel} bei dir`],
    [/\bschreibe?\s+dir\s+(die\s+\w+\s+)?gleich(\s+durch)?/gi,
     biz.status === "closed"
       ? `schreibe dir ${biz.reason === "Wochenende" ? "Montag" : "morgen"} die Details`
       : `schreibe dir die Details noch heute oder spätestens ${biz.nextOpenLabel}`],
  ];
  let out = text;
  for (const [re, repl] of replacements) out = out.replace(re, repl);
  return out;
}

/**
 * Bekannten Farbnamen im Bot-Output automatisch eine Shopify-URL aus der
 * colorUrlMap zuordnen. Sanitizer fügt URL unter den Farbnamen ein.
 */
export function autoAddColorUrls(text: string, colorUrlMap: Map<string, string>): string {
  if (colorUrlMap.size === 0) return text;
  return text.replace(
    /(^|\n)([•\-*]\s*)\*\*([A-ZÄÖÜ][A-ZÄÖÜ\s/+\-_0-9]{2,40})\*\*([^\n]*)/g,
    (match, prefix, bullet, colorName, rest) => {
      const key = (colorName as string).toUpperCase().trim();
      const url = colorUrlMap.get(key);
      if (!url) return match;
      if (/https?:\/\//.test(rest)) return match;
      const idx = text.indexOf(match);
      const tail = text.slice(idx + (match as string).length, idx + (match as string).length + 200);
      if (/^\s*\n\s*https?:\/\//.test(tail)) return match;
      return `${prefix}${bullet}**${colorName}**${rest}\n  ${url}`;
    }
  );
}

/**
 * URL-Color-Mismatch erkennen und strippen.
 * Beispiel: Bot schreibt **TAUPE** aber hängt URL mit "smoky-taupe" Slug an.
 * Das sind zwei verschiedene Farben. URL-Slug MUSS zum Farb-Namen passen.
 */
export function stripColorUrlMismatch(text: string): string {
  return text.replace(
    /(\*\*([A-ZÄÖÜ][A-ZÄÖÜ\s/+\-_0-9]{2,40})\*\*[^\n]*(?:\n[^\n]*){0,3}?)(https?:\/\/hairvenly\.de\/products\/([a-z0-9\-_/]+))/gi,
    (match, prefix, colorName, _fullUrl, slug) => {
      const cn = String(colorName).toUpperCase().trim();
      const s = String(slug).toLowerCase();
      // Bekannte Mismatch-Paare
      const rules: Array<{ when: (cn: string) => boolean; mustContain?: string[]; mustNotContain?: string[]; label: string }> = [
        // "TAUPE" alleine → URL darf nicht "smoky-taupe" enthalten
        { when: c => c === "TAUPE", mustNotContain: ["smoky-taupe"], label: "TAUPE vs SMOKY TAUPE" },
        // "SMOKY TAUPE" → URL muss "smoky-taupe" enthalten
        { when: c => c.includes("SMOKY TAUPE") || c === "SMOKY", mustContain: ["smoky-taupe"], label: "SMOKY TAUPE" },
        // Generisch: COLOR-Wort muss im URL-Slug irgendwo vorkommen (Mehrwort: erster Teil)
        // Beispiel: COLDNESS → slug muss "coldness" enthalten
        // Lass das raus weil viele Farben dynamisch sind und falsche Positiv-Treffer geben
      ];
      for (const r of rules) {
        if (!r.when(cn)) continue;
        if (r.mustContain && !r.mustContain.some(req => s.includes(req))) {
          console.warn(`[sanitizer] URL-COLOR-MISMATCH (${r.label}): "${cn}" + slug "${s}" — fehlt "${r.mustContain.join('/')}"`);
          return String(prefix);
        }
        if (r.mustNotContain && r.mustNotContain.some(f => s.includes(f))) {
          console.warn(`[sanitizer] URL-COLOR-MISMATCH (${r.label}): "${cn}" + slug "${s}" — darf nicht "${r.mustNotContain.join('/')}" enthalten`);
          return String(prefix);
        }
      }
      return match;
    }
  );
}

/**
 * Maximum N URLs pro Antwort. Wenn mehr → überzählige strippen.
 * Default: max 3 (eine Nachricht mit zu vielen Links wirkt überladen).
 *
 * Strategie:
 * - Findet alle hairvenly.de/products-URLs in Reihenfolge
 * - Behält die ersten N
 * - Strippt alle weiteren (mit optionaler Klammern/Bullets davor wenn
 *   sie auf eigener Zeile sind)
 */
export function limitUrls(text: string, maxUrls = 3): string {
  const urlRe = /https?:\/\/(?:www\.)?hairvenly\.de\/(?:products|collections)\/[A-Za-z0-9_\-/]+/g;
  const urls = Array.from(text.matchAll(urlRe));
  if (urls.length <= maxUrls) return text;

  // Welche URLs sollen weg? Alle ab Index maxUrls
  const toRemove = urls.slice(maxUrls).map(m => m[0]);
  let out = text;
  for (const u of toRemove) {
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Falls in Markdown-Link-Form: ganzen [Label](URL) entfernen
    out = out.replace(new RegExp(`\\[[^\\]]+\\]\\(${esc}\\)`, "g"), "");
    // Falls als nackte URL auf eigener Zeile: ganze Zeile entfernen
    out = out.replace(new RegExp(`(^|\\n)[ \\t]*${esc}[ \\t]*(\\n|$)`, "g"), "$1");
    // Sonst: nur URL entfernen (lassen Text drumrum)
    out = out.replace(new RegExp(esc, "g"), "");
  }
  if (toRemove.length > 0) {
    console.warn(`[sanitizer] limitUrls: ${toRemove.length} überzählige URL(s) gestrippt (hatten ${urls.length}, max=${maxUrls})`);
  }
  return out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * Em-Dash-Bremse — erster bleibt, ab dem zweiten ersetzen mit ", ".
 * Verhindert das KI-typische Über-Verwenden von Em-Dashes.
 */
export function emDashBrake(text: string): string {
  const dashRe = / +[—–] +/g;
  let count = 0;
  let out = text.replace(dashRe, (m) => {
    count++;
    return count === 1 ? m : ", ";
  });
  if (count >= 1) {
    out = out.replace(/\s*[—–]\s*\n/g, "\n");
  }
  return out
    .replace(/, ,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/ ,/g, ",");
}

/**
 * Wendet alle kontextfreien Sanitizer in der richtigen Reihenfolge an.
 * Wird sowohl in respond.ts (initialer Call) als auch refine.ts (Refine-Loop)
 * aufgerufen.
 *
 * Reihenfolge wichtig:
 *   1. Klammer-Disclaimer (vor allem anderen, damit es nicht andere Regex stört)
 *   2. Proaktive Foto-Angebote (kontextsensitiv via customerAskedForPhotos)
 *   3. Wochenende-Falle ("morgen" → "Montag")
 *   4. Closed-Handover ("Kollegin meldet sich gleich" außerhalb)
 *   5. Lieferanten-Namen
 *   6. Auto-URL für Farben (nur wenn colorUrlMap vorhanden)
 *   7. Em-Dash-Bremse zuletzt
 */
/**
 * Strip redundante Follow-up-Frage nach exhaustiver Auflistung.
 *
 * Wenn der Bot gerade eine Liste mit ≥3 Optionen ausgegeben hat (z.B. alle
 * verfügbaren Längen/Methoden zu einer Farbe) und am Ende fragt
 * "Welche Methode/Länge/Variante suchst du?" — diese Frage ist redundant,
 * weil die Kundin die Optionen DIREKT vor sich sieht. Wir strippen sie.
 *
 * Architektur (siehe CHATBOT_ARCHITECTURE.md §1.1):
 *   Bot soll nicht krampfhaft Folgefragen stellen, wenn die Antwort
 *   bereits exhaustiv ist. Nur fragen wenn es den Verkauf konkret fördert.
 */
export function stripRedundantFollowupQuestion(text: string): string {
  const lines = text.split("\n");
  // Zähle Bullets / Listeneinträge
  const bulletCount = lines.filter(l => /^\s*[-•*]\s+\S/.test(l) || /^\s*\d+\.\s+\S/.test(l)).length;
  // Schwelle 2: auch bei 2-Optionen-Listen ist "Welche willst du?" redundant —
  // die Kundin sieht die Optionen direkt vor sich. User-Feedback: "krampfhaft
  // fragen ohne sinnvollen Hintergrund". Bei 0-1 Bullets KEIN Strip, weil
  // dann die Frage ggf. zur Klärung dient.
  if (bulletCount < 2) return text;
  // Suche redundante Schluss-Frage in den letzten 3 nicht-leeren Zeilen
  const lastNonEmpty: number[] = [];
  for (let i = lines.length - 1; i >= 0 && lastNonEmpty.length < 3; i--) {
    if (lines[i].trim().length > 0) lastNonEmpty.push(i);
  }
  // SIBLING-SWEEP: nicht nur "Welche X suchst du?", sondern alle redundanten
  // Schluss-Fragen-Klassen nach exhaustiver Auflistung.
  const REDUNDANT_PATTERNS: RegExp[] = [
    // "Welche Methode/Länge/Variante/Farbe ... suchst du?"
    /^\s*(welche|welches|welcher)\s+(methode|länge|variante|farbe|kombination|option|davon|version|größe|menge)[^?]*\??\s*$/i,
    // "Magst/Möchtest du ... wissen/sehen/wählen?"
    /^\s*(möchtest|magst|willst)\s+du\b[^?]{0,80}(wissen|sehen|wählen|hören|haben|nehmen|bestellen)[^?]*\??\s*$/i,
    // "Soll ich dir ... schicken/zeigen/empfehlen?"
    /^\s*soll\s+ich\s+(dir|euch)\b[^?]{0,80}(schicken|zeigen|empfehlen|nennen|raussuchen|senden)[^?]*\??\s*$/i,
    // "Brauchst du noch ... Info/Hilfe?"
    /^\s*brauchst\s+du\b[^?]{0,80}(info|infos|hilfe|details|empfehlung|tipps?)[^?]*\??\s*$/i,
    // "Hast du noch Fragen?" / "Sonst noch was?"
    /^\s*(hast\s+du\s+(noch\s+)?(weitere\s+)?fragen|sonst\s+noch\s+(etwas|was)|kann\s+ich\s+sonst)[^?]*\??\s*$/i,
    // "Dann finde ich die passende X für dich"  (passive Aufforderung zur Methodenwahl)
    /^\s*dann\s+(finde|suche|empfehle|nenne)\s+ich[^.]{0,80}(passende[rn]?\s+)?(methode|länge|farbe|kombination|option)[^.]*\.\??\s*$/i,
  ];
  for (const idx of lastNonEmpty) {
    const line = lines[idx];
    for (const pat of REDUNDANT_PATTERNS) {
      if (pat.test(line)) {
        console.warn(`[sanitizer] stripping redundant follow-up question: "${line.trim()}"`);
        lines[idx] = "";
        break;
      }
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Markdown-Strip — Persona-Regel "KEIN Markdown" deterministisch erzwingen.
 *
 * WhatsApp/Instagram rendern kein Markdown, also würden Kunden literal
 * "**Hairvenly Showroom**" sehen. Diese Sanitizer entfernen die häufigsten
 * Markdown-Strukturen, die der Bot trotz Persona-Regel produziert.
 *
 * Behält bewusst:
 *   - URLs (werden separat via autoAddColorUrls/limitUrls verwaltet)
 *   - Listen mit "- " oder "• " (kein klassisches Markdown)
 */
export function stripMarkdownFormatting(text: string): string {
  let out = text;
  // Bold **x** und __x__ — Inhalt behalten, Marker entfernen
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "$1");
  out = out.replace(/__([^_\n]+?)__/g, "$1");
  // Markdown-Link [Label](URL) → "Label URL" (URL bleibt klickbar)
  out = out.replace(/\[([^\]\n]+?)\]\((https?:\/\/[^\s)]+)\)/g, "$1 $2");
  // Header-Prefix am Zeilenanfang entfernen (### Titel → Titel)
  out = out.replace(/(^|\n)#{1,6}\s+/g, "$1");
  // Italic _x_ und *x* — nur wenn von non-word/edge umgeben, damit
  // Wörter wie "snake_case" oder Bullet-Listen "* item" intakt bleiben
  out = out.replace(/(^|[\s(])\*([^*\n]{1,200}?)\*(?=[\s.,!?:;)\n]|$)/g, "$1$2");
  out = out.replace(/(^|[\s(])_([^_\n]{1,200}?)_(?=[\s.,!?:;)\n]|$)/g, "$1$2");
  // Blockquote-Marker entfernen ("> x" → "x")
  out = out.replace(/(^|\n)>\s+/g, "$1");
  return out;
}

/**
 * Strukturelle Validierung: Methode × Linie × Länge gegen echte DB.
 *
 * Physikalisch existierende Kombos (Stand 2026-05-27, aus product_methods +
 * product_lengths in der DB):
 *
 *   RUSSISCH GLATT (Amanda) — alle 60cm:
 *     - Bondings, Standard Tapes, Minitapes, Classic Weft, Invisible Weft,
 *       Genius Weft, Clip-ins (100/150/225g), Ponytail
 *
 *   USBEKISCH WELLIG (Eyfel):
 *     - Tapes: 45/55/65/85cm
 *     - Bondings: 65/85cm (KEIN 45/55!)
 *     - Classic Tressen: 65cm (NICHT „Classic Weft")
 *     - Genius Weft: 65cm
 *     - Ponytail: 65cm
 *
 * Validator-Klassen (jede strippt die ganze Zeile):
 *   1. Russisch + 45/55/65/85cm → unmöglich (Russisch ist nur 60cm)
 *   2. Usbekisch + 60cm → unmöglich
 *   3. „Mini Tapes/Minitapes" + Usbekisch → Mini Tapes existieren nur in Russisch
 *   4. „Classic Tressen" + Russisch → Russisch hat „Classic Weft", nicht Tressen
 *   5. „Classic Weft" oder „Invisible Weft" + Usbekisch → existieren nur Russisch
 *   6. Usbekisch Bondings + 45/55cm → Usbekisch Bondings nur 65/85cm
 *
 * Conservative-Prinzip: nur Zeilen mit klaren Constraint-Verletzungen werden
 * gestrippt. Bei Unsicherheit (nur eines der Anker) → keine Aktion.
 *
 * Prompt-Engineering hat 4 Iterationen lang versagt — strukturelle Validation
 * ist die einzige zuverlässige Lösung, weil sie deterministisch auf dem Output
 * läuft, nicht auf der LLM-Compliance.
 */
export function stripImpossibleLengthLineCombos(text: string): string {
  const lines = text.split(/\n/);
  const kept: string[] = [];
  let stripped = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    // Line-Indikatoren (immer prüfen — auch wenn keine cm-Angabe da ist)
    const hasRussisch = /\b(russisch|russische|russischen|russischer|russisches|russisch[\s-]?glatt|glatt(e|en|es|er)?)\b/i.test(lower);
    const hasUsbekisch = /\b(usbekisch|usbekische|usbekisches|usbekischer|usbekischen|us[\s-]?wellig|wellig(e|es|en|er)?)\b/i.test(lower);

    let impossible = false;
    let reason = "";

    // Klasse 3: Mini Tapes + Usbekisch — Mini Tapes existieren nur in Russisch glatt
    if (hasUsbekisch && /\b(mini[\s-]?tape|minitape)/i.test(lower)) {
      impossible = true;
      reason = "Mini Tapes + Usbekisch (Mini Tapes existieren nur in Russisch glatt)";
    }
    // Klasse 4: Classic Tressen + Russisch — Russisch hat „Classic Weft", nicht Tressen
    if (!impossible && hasRussisch && /\bclassic[\s-]?tresse/i.test(lower)) {
      impossible = true;
      reason = "Classic Tressen + Russisch (Russisch hat Classic Weft, nicht Tressen)";
    }
    // Klasse 5a: Classic Weft + Usbekisch
    if (!impossible && hasUsbekisch && /\bclassic[\s-]?weft/i.test(lower)) {
      impossible = true;
      reason = "Classic Weft + Usbekisch (gibt's nur in Russisch glatt)";
    }
    // Klasse 5b: Invisible Weft + Usbekisch
    if (!impossible && hasUsbekisch && /\binvisible[\s-]?weft/i.test(lower)) {
      impossible = true;
      reason = "Invisible Weft + Usbekisch (gibt's nur in Russisch glatt)";
    }

    // Längen-Checks (Klassen 1, 2, 6)
    if (!impossible) {
      const cmMatches = [...lower.matchAll(/\b(\d{2,3})\s*cm\b/g)];
      for (const m of cmMatches) {
        const cm = parseInt(m[1], 10);
        // Klasse 1: Russisch + 45/55/65/85cm
        if (hasRussisch && [45, 55, 65, 85].includes(cm)) {
          impossible = true;
          reason = `Russisch + ${cm}cm (Russisch ist nur 60cm)`;
          break;
        }
        // Klasse 2: Usbekisch + 60cm
        if (hasUsbekisch && cm === 60) {
          impossible = true;
          reason = `Usbekisch + ${cm}cm (Usbekisch ist 45/55/65/85cm)`;
          break;
        }
        // Klasse 6: Usbekisch Bondings + 45/55cm
        if (hasUsbekisch && /\bbonding/i.test(lower) && [45, 55].includes(cm)) {
          impossible = true;
          reason = `Usbekisch Bondings + ${cm}cm (Usbekisch Bondings nur 65/85cm)`;
          break;
        }
      }
    }

    if (impossible) {
      console.warn(`[sanitizer] IMPOSSIBLE_COMBO: ${reason} in line: "${line.slice(0, 100)}"`);
      stripped++;
      continue;
    }
    kept.push(line);
  }
  if (stripped > 0) {
    console.warn(`[sanitizer] stripImpossibleLengthLineCombos: ${stripped} Zeile(n) gestrippt`);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * URL↔Farbe-Slug-Token-Validator.
 *
 * Erkennt Fälle wo Bot eine Farbe X behauptet und eine URL postet, deren
 * Slug eine ANDERE Farbe enthält (z.B. "ESPRESSO BROWN" + URL .../caramel-fudge…).
 *
 * Ursache solcher Fälle: meistens Daten-Drift in product_colors.shopify_url
 * (DB sagt Farbe X = Espresso Brown, URL zeigt aber auf Caramel-Fudge-Slug).
 * Bot vertraut der DB → klickbare URL führt Kundin zum FALSCHEN Produkt.
 *
 * Logik:
 *   1. Tokenisiere Slug (nach Stopwords-Filter und DE→EN-Normalisierung)
 *   2. Finde Farbnamen-Claim 80-120 Zeichen VOR der URL (CAPS-Pattern,
 *      Bullet+CamelCase oder "**FARBE**")
 *   3. Tokenisiere Claim mit gleicher Normalisierung
 *   4. Wenn KEIN claim-Token in den slug-Tokens vorkommt → Mismatch
 *
 * Defensive: false-positive-Schutz durch Stopword-Liste + Min-Token-Länge 4.
 *
 * Sibling-Sweep: gleiches Pattern für /collections/-URLs (nicht implementiert
 * weil Bot per Regel keine Collection-Links posten soll).
 */
const COLOR_SLUG_STOPWORDS = new Set([
  // Methoden/Subtypes
  "tape", "tapes", "bondings", "bonding", "weft", "wefts", "tressen", "ponytail",
  "extensions", "extension", "mini", "standard", "classic", "invisible", "genius",
  "clip", "clips", "keratin", "butterfly",
  // Linien
  "russisch", "russisches", "russischen", "russische", "usbekisch", "usbekische",
  "wellig", "wellige", "glatt", "glatte", "haar", "haare", "echthaar", "us",
  // Maße / numerisch — werden separat behandelt
  // Sonstiges
  "die", "der", "das", "und", "oder", "ist", "mit", "von", "zu", "auf",
  "tape-extensions", "von-uns",
]);

/** Minimale DE→EN-Map für Farbtoken-Vergleich. Symmetrisch. */
const COLOR_SYNONYM_BIDIR: Array<[string, string]> = [
  ["braun", "brown"],
  ["schwarz", "black"],
  ["blond", "blonde"],
  ["blond", "blond"],
  ["rot", "red"],
  ["aschbraun", "ash"],
  ["aschbraune", "ash"],
  ["asch", "ash"],
  ["mokka", "mokka"],
  ["mokka", "mocha"],
  ["mokkabraun", "mocha"],
  ["mokkabraune", "mocha"],
  ["espresso", "espresso"],
  ["dunkel", "dark"],
  ["hell", "light"],
  ["kupfer", "copper"],
  ["karamell", "caramel"],
  ["honig", "honey"],
  ["pearl", "pearl"],
  ["snowy", "snowy"],
  ["smoky", "smoky"],
  ["taupe", "taupe"],
  ["champagner", "champagne"],
  ["natural", "natur"],
];

function expandColorToken(t: string): string[] {
  const out = new Set<string>([t]);
  for (const [a, b] of COLOR_SYNONYM_BIDIR) {
    if (t === a || t.includes(a)) out.add(b);
    if (t === b || t.includes(b)) out.add(a);
  }
  return Array.from(out);
}

function tokenizeForColorCompare(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s\-/]/g, " ")
    .split(/[\s\-/]+/)
    .filter(t => t.length >= 3) // 3 erlaubt "ash"/"red"/"tan" als gültige Color-Tokens
    .filter(t => !COLOR_SLUG_STOPWORDS.has(t))
    .filter(t => !/^\d+(cm|g)?$/.test(t))
    .filter(t => !/^[0-9]+[a-z]?$/.test(t)); // variant codes 2a/4a/3t/etc. raus
}

export function stripUrlColorSlugMismatch(text: string): { text: string; stripped: number } {
  if (!text || !text.includes("hairvenly.de/products/")) return { text, stripped: 0 };
  const urlRe = /https?:\/\/(?:www\.)?hairvenly\.de\/products\/([a-z0-9\-_/]+)(?:\?[^\s)]*)?/gi;
  const matches = Array.from(text.matchAll(urlRe));
  if (matches.length === 0) return { text, stripped: 0 };

  const toStrip: string[] = [];
  for (const m of matches) {
    const fullUrl = m[0];
    const slug = m[1];
    const urlIdx = m.index ?? 0;
    // Suche Farb-Claim 120 Zeichen davor (bis zur vorherigen URL oder Anfang)
    const prevUrlIdx = matches
      .filter(x => (x.index ?? 0) < urlIdx)
      .map(x => (x.index ?? 0) + x[0].length)
      .reduce((a, b) => Math.max(a, b), 0);
    const ctxStart = Math.max(prevUrlIdx, urlIdx - 200);
    const ctx = text.slice(ctxStart, urlIdx);

    // Versuche eine Farb-Claim-Zeile zu finden:
    // (a) **FARBNAME** ...
    // (b) Zeile, die mit • / - / * oder Variant-Code (z.B. "2A", "ESPRESSO") beginnt
    // (c) Letzter Satz vor URL
    let claim = "";
    const capsBoldMatch = ctx.match(/\*\*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß0-9\s/+\-]{2,40})\*\*/);
    const bulletColorMatch = ctx.split(/\n/).reverse().find(line => /^[\s•\-*]*([A-ZÄÖÜ0-9][A-ZÄÖÜa-zäöüß0-9\s]{2,40})/.test(line));
    if (capsBoldMatch) claim = capsBoldMatch[1];
    else if (bulletColorMatch) claim = bulletColorMatch;
    else claim = ctx.split(/[.!?\n]/).filter(Boolean).slice(-1)[0] || "";

    const claimTokens = tokenizeForColorCompare(claim).flatMap(expandColorToken);
    const slugTokens = tokenizeForColorCompare(slug).flatMap(expandColorToken);
    if (claimTokens.length === 0 || slugTokens.length === 0) continue;

    const overlap = claimTokens.some(ct => slugTokens.some(st => st === ct || st.includes(ct) || ct.includes(st)));
    if (!overlap) {
      console.warn(`[sanitizer] URL-COLOR-SLUG-MISMATCH claim="${claim.trim().slice(0, 60)}" → slug="${slug}" (claimT=${claimTokens.join(",")} slugT=${slugTokens.join(",")})`);
      toStrip.push(fullUrl);
    }
  }

  if (toStrip.length === 0) return { text, stripped: 0 };
  let out = text;
  for (const u of Array.from(new Set(toStrip))) {
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\[[^\\]\\n]+\\]\\(${esc}\\)`, "g"), "");
    out = out.replace(new RegExp(`\\s*\\(${esc}\\)`, "g"), "");
    out = out.replace(new RegExp(`(^|\\n)[ \\t]*[•\\-*]?[ \\t]*${esc}[ \\t]*(?=\\n|$)`, "g"), "$1");
    out = out.replace(new RegExp(esc, "g"), "");
  }
  out = out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
  return { text: out, stripped: toStrip.length };
}

/**
 * Detect: Bot behauptet OFFEN-Status für einen Tag, der laut
 * Day-Query-Pre-LLM-Check ZU ist (Wochenende, Feiertag).
 *
 * Pattern wie detectStrandedContactInfo: KEIN Stripping (false-positive-
 * Risiko zu hoch — Bot könnte z.B. korrekt "morgen ist Samstag, da sind
 * wir zu" schreiben, was beides Wochentag UND "zu" enthält). Stattdessen
 * Force-Draft: MA prüft und korrigiert.
 *
 * Bug 2026-05-29 (Freitag): Bot bestätigte "Ja genau, morgen haben wir
 * offen von 10-18 Uhr 💕" obwohl morgen Samstag. Persona sagt zwar
 * "Mo-Fr 10-18" aber Sonnet rechnet nicht selbst den Wochentag aus.
 *
 * Erwarteter Caller (respond.ts): nutzt pipelineCtx.dayQueryMatches.
 */
export function detectFalseOpeningClaim(
  text: string,
  dayQueryMatches: Array<{ trigger: string; status: { isOpen: boolean; weekday: string; reason: string } }>,
): { suspicious: boolean; reason: string | null } {
  if (!text || !dayQueryMatches || dayQueryMatches.length === 0) {
    return { suspicious: false, reason: null };
  }
  const closedDays = dayQueryMatches.filter(m => !m.status.isOpen);
  if (closedDays.length === 0) return { suspicious: false, reason: null };

  const lower = text.toLowerCase();
  // "Offen"-Indikatoren in der Nähe eines Tag-Triggers
  const openIndicators = /(offen|geöffnet|auf|geboten|da\s+sind\s+wir|haben\s+wir\s+(auf|offen|geöffnet)|von\s+10[\s:-]?\s*(bis|-)\s*18|10[\s:-]?\s*[-–]\s*18|10\s*uhr|zwischen\s+10\s+und\s+18)/i;
  // Aber: explizite Verneinung („nicht offen", „leider zu", „geschlossen") darf
  // direkt vor/nach dem Trigger NICHT als false-claim zählen.
  const closedIndicators = /(zu|geschlossen|nicht\s+(offen|geöffnet|auf)|leider\s+nicht|haben\s+wir\s+(zu|geschlossen|leider))/i;

  for (const m of closedDays) {
    const trigger = m.trigger.split(" ")[0]; // "samstag (wochenende)" → "samstag"
    // Suche Trigger im Text + nahe Umgebung (±80 Zeichen)
    const triggerRe = new RegExp(`\\b${trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    let match;
    while ((match = triggerRe.exec(lower)) !== null) {
      const start = Math.max(0, match.index - 80);
      const end = Math.min(lower.length, match.index + 80);
      const window = lower.slice(start, end);
      const claimsOpen = openIndicators.test(window);
      const claimsClosed = closedIndicators.test(window);
      // Wenn "offen"-Aussage näher am Trigger als "zu"-Aussage → suspicious
      if (claimsOpen && !claimsClosed) {
        return {
          suspicious: true,
          reason: `Bot behauptet OFFEN für "${m.trigger}" (${m.status.weekday}, ${m.status.reason}), aber wir sind ZU. Snippet: "${window.trim()}"`,
        };
      }
    }
  }
  return { suspicious: false, reason: null };
}

/**
 * "Jeden-Moment-eintreffen"-Phrasen weichspülen.
 *
 * Bug 2026-05-30: Bot sagte "müssten also jeden Moment eintreffen" zu einer
 * ca.-ETA (30.05., Samstag — Salon zu, kein Wareneingang am Wochenende).
 * Solche Aussagen sind doppelt falsch:
 *   - "ca."-Daten sind ±3-7 Tage ungenau, nicht "jeden Moment"
 *   - am Wochenende kommt sowieso nichts
 *
 * Wir ersetzen die problematischen Phrasen durch neutralere Formulierungen.
 * Das ist eine WEICHE Korrektur (Sanitizer) — die Hauptlogik soll der
 * Persona-FAQ "eta-ca-wording-no-jetzt-jeden-moment" leisten.
 */
export function softenImmediateArrivalClaims(text: string): string {
  if (!text) return text;
  let out = text;
  const replacements: Array<[RegExp, string]> = [
    // "müssten also jeden Moment eintreffen" / "sollten jeden Moment ankommen"
    [/\b(müssten?|sollten?|werden)\s+(also\s+)?jeden\s+moment\s+(ein-?\s?treffen|ankommen|da\s+sein|kommen|rein\s?(kommen)?)\b/gi,
     "$1 in den nächsten Tagen ankommen"],
    // "treffen jeden Moment ein"
    [/\btreffen\s+jeden\s+moment\s+ein\b/gi, "treffen in den nächsten Tagen ein"],
    // "sind gleich da" im Lager-/Liefer-Kontext
    [/\b(sind|kommen)\s+gleich\s+(da|rein|an)\b/gi, "$1 voraussichtlich in den nächsten Tagen $2"],
    // "kommt sicher am [Datum]" → "kommt voraussichtlich"
    [/\b(kommt|kommen)\s+sicher\s+(am|um\s+den)\b/gi, "$1 voraussichtlich $2"],
  ];
  for (const [pat, sub] of replacements) {
    const before = out;
    out = out.replace(pat, sub);
    if (before !== out) {
      console.warn(`[sanitizer] softenImmediateArrivalClaims: weichgespült "${pat}"`);
    }
  }
  return out;
}

export function applyAllOutputSanitizers(
  text: string,
  opts: { customerAskedForPhotos?: boolean; colorUrlMap?: Map<string, string> } = {}
): string {
  let out = text;
  out = stripSelfReferentialDisclaimer(out);
  out = stripProactivePhotoOffer(out, opts.customerAskedForPhotos === true);
  // Verstrandete WhatsApp-Nummer rausstrippen (Bug 2026-05-30, Britt)
  {
    const r = stripStrandedWhatsappNumber(out);
    out = r.text;
  }
  // ETA-"jeden Moment"-Phrasen weichspülen (Bug 2026-05-30 bei ca.-Datum am Wochenende)
  out = softenImmediateArrivalClaims(out);
  // 🚨 STRUKTURELLER VALIDATOR: physikalisch unmögliche Längen-Linien-
  // Kombinationen rausstrippen (z.B. „Mini Tapes 55cm russisch glatt").
  // Greift FRÜH, damit nachfolgende Sanitizer auf bereinigtem Text laufen.
  out = stripImpossibleLengthLineCombos(out);
  out = scrubWeekendTrap(out);
  out = scrubClosedHandover(out);
  out = scrubSupplierNames(out);
  out = stripColorUrlMismatch(out);
  // Zusätzlich: Slug-Token vs. Farb-Claim-Token (deckt DB-Drift wie
  // "Espresso Brown" → URL caramel-fudge-… ab).
  {
    const r = stripUrlColorSlugMismatch(out);
    if (r.stripped > 0) console.warn(`[sanitizer] stripUrlColorSlugMismatch: ${r.stripped} URL(s) gestrippt (Slug-Token vs Farb-Claim)`);
    out = r.text;
  }
  if (opts.colorUrlMap) out = autoAddColorUrls(out, opts.colorUrlMap);
  // URL-Limit VOR Markdown-Strip — limitUrls erkennt noch [Label](URL)-Form
  out = limitUrls(out, 3);
  // Redundante Follow-up-Frage nach exhaustiver Liste strippen
  out = stripRedundantFollowupQuestion(out);
  // Markdown-Strip ZULETZT (vor emDashBrake), damit alle vorherigen
  // Sanitizer ihre Pattern noch mit Markdown matchen können
  out = stripMarkdownFormatting(out);
  out = emDashBrake(out);
  return out;
}
