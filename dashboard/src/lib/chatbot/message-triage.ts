/**
 * MESSAGE-TRIAGE — Single Source of Truth für die Frage:
 *   "Soll der Bot auf diese eingehende Kundennachricht ÜBERHAUPT reagieren?"
 *
 * Diese Logik lag früher verstreut + ungetestet in webhooks/meta/route.ts.
 * Folge: Bugs derselben Klasse kamen immer wieder (Story-Mention, Emoji-only,
 * reine Dankesnachricht → Bot antwortete trotzdem / halluzinierte Farbanalyse).
 *
 * Jetzt: EINE Datei, MIT Smoke-Test (scripts/smoke/message-triage.spec.mjs),
 * die alle historischen User-Beschwerden als Testfälle festschreibt. Neue
 * Fälle → hier ergänzen + Test erweitern, nie wieder im Webhook „pflastern".
 *
 * Drei Entscheidungen:
 *   1) shouldBotIgnore()          → Engagement/Reaktion ohne Anliegen → skip
 *   2) isClosingAcknowledgement() → reine Abschluss-/Dankesnachricht → skip
 *      (nur wenn letzte Bot-Nachricht keine offene Frage hatte — Check am
 *       Call-Site, da DB-Zugriff nötig)
 */

export interface TriageAttachment {
  type: string;
  url?: string;
}

/**
 * Instagram-„Engagement"-Attachments OHNE echtes Service-Anliegen:
 * - story_mention: Kundin erwähnt uns in IHRER Story (kein Anliegen, kein Foto an uns)
 * - story_reply:   Kundin antwortet auf UNSERE Story (meist nur Emotion „schön!")
 * - ig_post / ig_reel / share: Kundin teilt einen Beitrag (kein Anliegen)
 * - reaction / like: reine Emoji-Reaktion auf eine Nachricht
 *
 * Diese lösen NUR dann eine Bot-Antwort aus, wenn der Begleittext eine echte
 * Frage / ein konkretes Anliegen enthält (siehe hasRealIntent()).
 */
const ENGAGEMENT_TYPES = new Set([
  "story_mention",
  "story_reply",
  "ig_post",
  "ig_reel",
  "share",
  "reaction",
  "like",
]);

/**
 * "Echte" Medien-Anhänge, auf die der Bot reagieren SOLL (bzw. die anderswo
 * behandelt werden — Foto-Farbanalyse, Audio/Video/Ephemeral-Bypass).
 * Wichtig: image bleibt hier → ein echtes Foto ist KEIN ignorierbares Event.
 */
const REAL_MEDIA_TYPES = new Set(["image", "video", "audio", "ephemeral"]);

/**
 * Entfernt reine Attachment-Label-Platzhalter aus dem Text. Meta/unser Sync
 * füllt content z.B. mit "[Foto]", "[Video]", "[Story-Mention]" wenn keine
 * echte Textnachricht da ist. Das ist KEIN Kundentext und darf nicht als
 * „echtes Anliegen" zählen.
 */
export function stripAttachmentLabels(text: string): string {
  return (text || "")
    .replace(/\[(Foto|Video|Audio|Einmal-Foto|Story-Mention|Story-Reply|Sticker|GIF|Bild|Reel|Beitrag|Geteilt|Anhang)[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Hat der (label-bereinigte) Text eine echte Frage oder ein konkretes Anliegen?
 * Fragezeichen ODER ein Anliegen-Keyword (Produkt/Preis/Termin/Verfügbarkeit…).
 */
export function hasRealIntent(text: string): boolean {
  const t = stripAttachmentLabels(text).toLowerCase();
  if (t.length === 0) return false;
  if (/\?/.test(t)) return true;
  return /\b(wie|wann|wo|warum|wieso|welche|welcher|welches|habt|haben|hast|gibt|kommt|kommen|preis|kostet|kosten|kaufen|bestell|reservier|verfügbar|verfuegbar|frei|termin|öffnung|oeffnung|adresse|kontakt|größe|groesse|länge|laenge|farbe|farbton|methode|tape|bonding|tressen|clip|ponytail|info|frage|möcht|moecht|brauche|suche|interesse|interessiert|empfehl|beratung)\b/i.test(t);
}

/**
 * Verweist der Text DEMONSTRATIV auf etwas Visuelles, das der Bot NICHT sehen
 * kann (z.B. die Farbe in einer Story/einem Bild)? → "diese Farbe", "diesen
 * Ton", "die hier", "das da", "sowas", "genau das".
 *
 * Hintergrund (User-Bug 08.06): Kundin antwortet auf eine STORY mit "Kann ich
 * diese Farbe in 60cm finden?". Der Bot kann die Story NICHT sehen → er hat
 * keine Farbe → er HALLUZINIERTE "#2E". Solche Bezüge dürfen NICHT automatisch
 * beantwortet werden (nur wenn ein echtes Foto dabei ist, das wir analysieren
 * können — das wird in shouldBotIgnore über REAL_MEDIA_TYPES abgefangen).
 */
export function referencesUnseenVisual(text: string): boolean {
  const t = stripAttachmentLabels(text).toLowerCase();
  if (!t) return false;
  // Demonstrativ-Bezug auf eine FARBE/einen Ton ("diese Farbe", "diesen Ton" …)
  if (/\b(diese|diesen|dieser|dieses)\s+(farbe|farbton|ton|t[oö]ne|nuance|colou?r)\b/.test(t)) return true;
  // "die hier" / "das da" usw.
  if (/\b(die|das|den)\s+(hier|da)\b/.test(t)) return true;
  // "sowas", "so eine", "genau das/die"
  if (/\bso\s?(was|ein|eine|einen)\b/.test(t)) return true;
  if (/\bgenau\s+(das|die|den|sowas)\b/.test(t)) return true;
  return false;
}

/**
 * Reine Emoji-/Mini-Bestätigungs-Reaktion ohne Inhalt?
 * ("😍", "❤️", "ok", "danke", "👍" …)
 */
export function isEmojiOrMiniAck(text: string): boolean {
  const raw = stripAttachmentLabels(text);
  if (raw.length === 0) return true;

  // Mini-Bestätigungen ohne Frage
  const miniAcks = /^(ok|okay|okey|oki|👌|jo|jep|aha|achso|achsoo+|ahso+|mhm|hm+|alles\s+klar|cool|gut|guut|super|nice|toll|danke|danke!|dankee+|merci|gerne|gern|jaja|jaaa+|👍|🙏|🥰|😍|😘|❤️|💕|💗)\.?!?$/iu;
  if (miniAcks.test(raw.trim())) return true;

  // Emojis + Sonderzeichen strippen → wenn < 2 alphanumerische Zeichen übrig
  const stripped = raw
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\p{Emoji_Modifier_Base}/gu, "")
    .replace(/\p{Emoji_Modifier}/gu, "")
    .replace(/‍/g, "")
    .replace(/[☀-➿]/g, "")
    .replace(/[︀-️]/g, "");
  const alphanumeric = stripped.replace(/[^\p{L}\p{N}]/gu, "");
  return alphanumeric.length < 2;
}

/**
 * HAUPT-ENTSCHEIDUNG: Soll der Bot diese Nachricht IGNORIEREN (nicht antworten,
 * kein Entwurf, keine LLM-Kosten)?
 *
 * true (ignorieren) wenn:
 *   - reine Emoji-/Mini-Ack ohne echtes Anliegen, ODER
 *   - Engagement-Attachment (Story-Mention/-Reply, geteilter Post, Reaktion)
 *     OHNE echtes Anliegen im Begleittext.
 *
 * false (Bot soll ran) wenn:
 *   - echter Text mit Frage/Anliegen, ODER
 *   - echtes Medium (Foto/Video/Audio/Ephemeral) — wird an anderer Stelle
 *     behandelt (Foto-Analyse bzw. Medien-Bypass).
 */
export function shouldBotIgnore(text: string, attachments: TriageAttachment[] = []): boolean {
  const atts = attachments || [];

  // Echtes Medium dabei (Foto/Video/Audio/Ephemeral)? → NICHT hier ignorieren.
  // (Foto = Farbanalyse; Video/Audio/Ephemeral = eigener Bypass.)
  if (atts.some(a => REAL_MEDIA_TYPES.has(a.type))) return false;

  const hasEngagement = atts.some(a => ENGAGEMENT_TYPES.has(a.type));

  // Engagement-Attachment (Story-Mention/-Reply etc.):
  if (hasEngagement) {
    if (!hasRealIntent(text)) return true;            // kein Anliegen → ignorieren
    // Anliegen DA, aber es bezieht sich demonstrativ auf die Story/das Bild,
    // das wir NICHT sehen ("diese Farbe in 60cm?"). Der Bot würde die Farbe
    // raten/halluzinieren → NICHT automatisch antworten. Die MA sieht die
    // Story auf Instagram und antwortet (oder fragt nach dem Farbnamen).
    if (referencesUnseenVisual(text)) return true;
    return false;
  }

  // Kein Anhang: reine Emoji/Mini-Ack ohne Anliegen → ignorieren.
  if (isEmojiOrMiniAck(text) && !hasRealIntent(text)) return true;

  return false;
}

/**
 * Reine Abschluss-/Dankesnachricht ("Okay perfekt vielen Dank ❤️").
 * WHITELIST-Ansatz: jedes Wort muss Dank/Bestätigung/Füllwort sein UND
 * mindestens ein starkes Closer-Wort (danke/perfekt/passt…) dabei.
 *
 * Die Kontext-Prüfung (hatte letzte Bot-Nachricht eine offene Frage?) passiert
 * am Call-Site (DB-Zugriff nötig) — hier nur die reine Text-Erkennung.
 */
export function isClosingAcknowledgement(text: string, attachments: TriageAttachment[] = []): boolean {
  const raw = (text || "").trim();
  if (!raw) return false;

  // Echte (nicht-Engagement-)Anhänge → nicht unterdrücken.
  const hasRealAttachment = (attachments || []).some(
    a => !["reaction", "like"].includes(a.type)
  );
  if (hasRealAttachment) return false;

  if (raw.includes("?")) return false;

  const norm = raw
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return false;

  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) return false;

  const FILLER = new Set([
    "danke","dank","dankeschoen","dankee","dankeee","dankoe","merci","thanks","thx","thank","you","vielen","vielmals","herzlichen","tausend","besten",
    "ok","okay","oki","okey","okok","alles","klar","gut","guut","super","perfekt","prefekt","top","klasse","mega","prima","wunderbar","toll","passt","passts","verstanden","geht","ordnung","cool","nice","schoen","lieb","lieben","liebe","liebes","nett","spitze","wow","hammer","yay",
    "freut","freu","mich","gefreut","dir","euch","das","ist","du","ihr","na","dann","also","ja","jaa","joa","jo","echt","wirklich","so","an","dich","mal","nochmal","noch","sehr","ach","achso","aso","gerne","gern",
  ]);
  const STRONG = new Set([
    "danke","dank","dankeschoen","dankee","dankeee","dankoe","merci","thanks","thx","thank",
    "perfekt","prefekt","passt","passts","verstanden","top","klasse","spitze",
  ]);

  let sawStrong = false;
  for (const tok of tokens) {
    if (!FILLER.has(tok)) return false;
    if (STRONG.has(tok)) sawStrong = true;
  }
  return sawStrong;
}
