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

export function applyAllOutputSanitizers(
  text: string,
  opts: { customerAskedForPhotos?: boolean; colorUrlMap?: Map<string, string> } = {}
): string {
  let out = text;
  out = stripSelfReferentialDisclaimer(out);
  out = stripProactivePhotoOffer(out, opts.customerAskedForPhotos === true);
  out = scrubWeekendTrap(out);
  out = scrubClosedHandover(out);
  out = scrubSupplierNames(out);
  out = stripColorUrlMismatch(out);
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
