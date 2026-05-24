/**
 * Deterministischer Intent-Detector + Template-Renderer für KONTAKT-Anfragen
 * (Adresse, Telefon, Öffnungszeiten, E-Mail).
 *
 * Diese Anfragen werden NICHT an Sonnet gegeben. Stattdessen:
 *  1. Keyword-Match auf User-Message
 *  2. Wenn Match: feste Template-Antwort mit Werten aus business-config.ts
 *  3. Bot-Output ist 100% deterministisch — keine Halluzinations-Chance
 *
 * Spart außerdem Kosten: 0 LLM-Token, 0 Latency.
 *
 * Pattern inspiriert vom Audio-Bypass (statische Antworten für nicht-LLM-Fälle).
 */
import { BUSINESS_CONFIG } from "./business-config";

export type ContactIntent =
  | "address_or_location"  // "wo seid ihr?", "adresse?", "showroom?"
  | "address_correction"   // "ich muss in die hans-bernhard?" → FALSCHE Adresse, korrigieren
  | "phone"                // "telefonnummer?", "rufnummer?"
  | "phone_correction"     // "0421/234567 ist eure?" → FALSCHE Nummer
  | "email"                // "email?", "mail?"
  | "email_correction"     // "info@hairvenli.de richtig?" → falsche Email
  | "opening_hours"        // "öffnungszeiten?", "wann habt ihr offen?"
  | "hours_correction"     // "ihr habt bis 19 Uhr offen, oder?" → falsche Stunden
  | "general_contact"      // "wie erreiche ich euch?"
  | null;

/**
 * Erkennt deterministisch ob die User-Message nach Kontakt-Infos fragt.
 * Returns den spezifischen Intent oder null wenn nicht erkannt.
 *
 * WICHTIG: konservativ matchen — lieber unsicher → null und LLM lassen,
 * als false-positive ein Template feuern wenn die Kundin was anderes will.
 */
export function detectContactIntent(userMessage: string): ContactIntent {
  if (!userMessage) return null;
  const t = userMessage.toLowerCase().trim();
  // Sehr kurze oder sehr lange Nachrichten ausschließen (false-positive-Schutz):
  // Sehr kurz = wahrscheinlich nicht eindeutig. Sehr lang = vermutlich komplexer
  // Kontext der nicht nur Kontakt-Info will.
  if (t.length < 6 || t.length > 250) return null;

  // Wenn eine konkrete Produkt-/Bestell-Frage drin steckt: KEIN Contact-Intent,
  // sondern normal Bot. (Vermeidet false-positives wenn jemand "Adresse" zusammen
  // mit "Bestellung" oder "wann liefert ihr" sagt.)
  if (/\b(bestell|kauf|bezahl|farbe|tape|tresse|bonding|gramm|länge|cm|preis|kostet|haar|verlänger|verdicht)\b/i.test(t)) {
    return null;
  }

  // ADRESS-KORREKTUR: Kunde nennt eine FALSCHE Adresse und fragt nach Bestätigung
  // ("muss ich in die hans-bernhard?", "ihr seid ja in der parkallee?")
  // Wenn der Kunde einen Straßennamen nennt, der NICHT die echte Adresse ist,
  // muss der Bot KORRIGIEREN — nicht bestätigen mit "Genau, richtig 💕".
  // Erkennung: Straße-Suffix-Wort + Frage-Marker irgendwo in der Message.
  // WICHTIG: Lücken mit `[^\n]` (NICHT `[^.\n]`) — sonst springt Regex nicht
  //   über "str." hinweg, wenn der Punkt im Straßenkürzel steht.
  // Sibling-Sweep: 3 Patterns decken die häufigen Formulierungen ab:
  //   (1) Frage-Verb + Straße im selben Satz
  //   (2) Straße + "richtig?/stimmt?/oder?" Bestätigungsfrage
  //   (3) "ihr seid/sind"-Form + Straße (ergänzt Pattern 1, wo Wortreihenfolge anders ist)
  // STREET_WORD matched ein WORT das mit einem Straßen-Suffix ENDET.
  // \w* davor → "parkallee", "haferwende", "buchtstraße" werden gefangen.
  const STREET_WORD = /\b\w*(?:stra(?:ß|ss)e|str\.?|allee|weg|platz|ring|gasse|chaussee|wende|pfad|ufer|damm|stieg|twiete|markt|hof)\b/i;
  const hasStreetSuffix = STREET_WORD.test(t);
  const isCorrectionForm =
    // Pattern A: Frage-Verb + Straße im selben Satz
    /\b(muss ich|fahre ich|komme ich|kommt man|ist das|sind das|ist es|seid ihr in|liegt das in|heißt es|in die)\b[^\n]{0,40}\b\w*(?:stra(?:ß|ss)e|str\.?|allee|weg|platz|ring|gasse|chaussee|wende|pfad|ufer|damm|stieg|twiete|markt|hof)\b/i.test(t) ||
    // Pattern B: Straße + "richtig/stimmt/oder"-Bestätigungsfrage
    /\b\w*(?:stra(?:ß|ss)e|str\.?|allee|weg|platz|ring|gasse|chaussee|wende|pfad|ufer|damm|stieg|twiete|markt|hof)\b[^\n]{0,30}(richtig|stimmt|oder)\??/i.test(t) ||
    // Pattern C: irgendwo Straße + Frage-Form → wahrscheinlich Adress-Frage
    (hasStreetSuffix && /\?\s*$/.test(t.split(/[.!]/).pop() || t));
  if (isCorrectionForm) {
    // Extrahiere genannten Straßennamen (vereinfachte Heuristik)
    const streetMatch = t.match(/\b([a-zäöüß][a-zäöüß-]{2,30})(?:[-\s])?(stra(?:ß|ss)e|str\.?|allee|weg|platz|ring|gasse|chaussee)\b/i);
    if (streetMatch) {
      const mentionedStreet = streetMatch[0].toLowerCase().replace(/\s+/g, "").replace(/ß/g, "ss").replace(/[-_]/g, "");
      const realStreet = BUSINESS_CONFIG.street.toLowerCase().replace(/\s+/g, "").replace(/ß/g, "ss").replace(/[-_]/g, "");
      // Wenn die genannte Straße NICHT mit der echten beginnt/übereinstimmt → Korrektur
      if (!realStreet.includes(mentionedStreet.slice(0, 6)) && !mentionedStreet.includes(realStreet.slice(0, 6))) {
        return "address_correction";
      }
    }
    // PLZ-Check: nennt der Kunde eine FALSCHE PLZ?
    const plzMatch = t.match(/\b(\d{5})\b/);
    if (plzMatch && plzMatch[1] !== BUSINESS_CONFIG.postal_code) {
      return "address_correction";
    }
  }

  // ADRESSE / STANDORT / SHOWROOM
  if (/\b(wo (seid|sitzt|finde|find)|adresse|standort|showroom|laden|studio|vor.ort|wo kann ich|kommen|vorbeikommen|vorbeischauen)\b/i.test(t)) {
    return "address_or_location";
  }

  // TELEFON-KORREKTUR: Kunde nennt eine FALSCHE Telefonnummer + Frage-Marker
  // "ist 0421/12345 eure Nummer?", "ich rufe 030/... an, richtig?"
  // Vergleich: nur Ziffern beider Nummern → wenn ungleich, Korrektur.
  {
    const phoneInText = t.match(/(?:\+?\d[\d\s\/\-.()]{7,18}\d)/);
    if (phoneInText && /\b(richtig|stimmt|euer[e]?\s*nummer|eure\s*nummer|ist (das|es) (eure|deine)|anrufen|telefon|rufnummer|whatsapp.{0,15}\d)/i.test(t)) {
      const txtDigits = phoneInText[0].replace(/\D/g, "");
      const realDigits = BUSINESS_CONFIG.whatsapp_number.replace(/\D/g, "");
      // Match nur, wenn beide ≥8 stellig und letzte 8 Ziffern ungleich
      if (txtDigits.length >= 8 && txtDigits.slice(-8) !== realDigits.slice(-8)) {
        return "phone_correction";
      }
    }
  }

  // TELEFON
  if (/\b(telefon|tel\.?[\s\d]|rufnummer|anrufen|nummer|whatsapp.+nummer)\b/i.test(t)) {
    return "phone";
  }

  // EMAIL-KORREKTUR: Kunde nennt eine FALSCHE Email-Adresse + Frage-Marker
  // "info@hairvenli.de richtig?", "schreibe ich an kontakt@hairvenli.de?"
  {
    const mailInText = t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (mailInText && /\b(richtig|stimmt|eure|euer|deine|schreibe|sende|maile)/i.test(t)) {
      const mentioned = mailInText[0].toLowerCase().trim();
      if (mentioned !== BUSINESS_CONFIG.email.toLowerCase()) {
        return "email_correction";
      }
    }
  }

  // E-MAIL
  if (/\b(e[-\s]?mail|mail.adresse|@hairvenly|schreibe.+mail)\b/i.test(t)) {
    return "email";
  }

  // ÖFFNUNGSZEITEN-KORREKTUR: Kunde nennt FALSCHE Uhrzeit/Tag mit Frage-Marker
  // "ihr habt bis 19 Uhr offen, oder?", "samstag geöffnet?"
  {
    const hourMentioned = t.match(/\b(\d{1,2})\s*uhr\b/);
    const hasOpenWord = /\b(offen|geöffnet|habt|öffnet|schließt|schließt|zu)\b/.test(t);
    const hasQuestionMark = /\b(richtig|stimmt|oder|wirklich)\??/.test(t) || /\?/.test(t);
    if (hourMentioned && hasOpenWord && hasQuestionMark) {
      const hourNum = parseInt(hourMentioned[1], 10);
      // Falls die genannte Stunde NICHT zwischen Open-Start und Open-End liegt
      // (z.B. "bis 19 Uhr" oder "ab 9 Uhr" während wir 10-18 sind)
      if (hourNum < BUSINESS_CONFIG.opening_start_hour || hourNum > BUSINESS_CONFIG.opening_end_hour) {
        return "hours_correction";
      }
    }
    // Samstag/Sonntag-Frage
    if (/\b(samstag|sonntag|wochenende)\b[^.\n]{0,20}\b(offen|geöffnet|da)\b/.test(t)) {
      return "hours_correction";
    }
  }

  // ÖFFNUNGSZEITEN
  if (/\b(öffnungszeit|wann (habt|seid|geöffnet|offen)|geöffnet|offen.*uhr|wann.*da)\b/i.test(t)) {
    return "opening_hours";
  }

  // ALLGEMEINER KONTAKT
  if (/\b(wie (erreich|kontakt|kontakte ich)|kontaktdaten|erreichbar)\b/i.test(t)) {
    return "general_contact";
  }

  return null;
}

/**
 * Rendert die Template-Antwort für einen erkannten Contact-Intent.
 * Liefert IMMER die Werte aus BUSINESS_CONFIG — keine LLM-Generierung.
 *
 * Stil: warm, kurz, Hairvenly-Tonalität (so wie der Bot sonst auch antwortet).
 */
export function renderContactResponse(intent: ContactIntent): string {
  const c = BUSINESS_CONFIG;
  switch (intent) {
    case "address_or_location":
      return [
        "Ja klar, sehr gerne 💕",
        "",
        "Du kannst dir die Farben bei uns vor Ort anschauen und an dein Haar matchen:",
        "",
        `📍 **${c.studio_name}**`,
        c.address_oneline,
        "",
        `🕒 **${c.opening_hours_text}**`,
        "",
        `${c.booking_note} Erreichbar über WhatsApp ${c.whatsapp_number} oder ${c.email}.`,
        "",
        "Kommst du aus der Gegend? 🤍",
      ].join("\n");

    case "address_correction":
      // Kunde hat eine FALSCHE Adresse genannt — höflich korrigieren, NIE bestätigen
      return [
        `Fast 💕 — wir sind tatsächlich in der ${c.street}, ${c.postal_code} ${c.city}.`,
        "",
        `🕒 ${c.opening_hours_text}`,
        "",
        "Magst du in Google Maps reinschauen? Dort findest du uns sofort.",
      ].join("\n");

    case "phone_correction":
      // Kunde hat FALSCHE Telefonnummer genannt
      return [
        `Fast 💕 — unsere Nummer ist ${c.whatsapp_number} (WhatsApp).`,
        "",
        `📧 Oder per E-Mail: ${c.email}`,
      ].join("\n");

    case "email_correction":
      // Kunde hat FALSCHE Email genannt (z.B. Typo wie "hairvenli.de")
      return [
        `Fast 💕 — die richtige Adresse ist ${c.email}.`,
        "",
        `💬 Schneller geht's per WhatsApp: ${c.whatsapp_number}`,
      ].join("\n");

    case "hours_correction":
      // Kunde nennt FALSCHE Öffnungszeit (z.B. "bis 19 Uhr" oder Samstag)
      return [
        `Nicht ganz 💕 — wir sind ${c.opening_hours_text} für dich da.`,
        "",
        `Am ${c.closed_days.join(" und ")} ist der Showroom zu.`,
      ].join("\n");

    case "phone":
      return [
        "Du erreichst uns am schnellsten per WhatsApp 🩷",
        "",
        `💬 **WhatsApp:** ${c.whatsapp_number}`,
        `📧 **E-Mail:** ${c.email}`,
        "",
        `Im Studio sind wir ${c.opening_hours_text} für dich da.`,
      ].join("\n");

    case "email":
      return `Schreib uns gerne an **${c.email}** 💌\n\nOder via WhatsApp unter ${c.whatsapp_number} — da antworten wir meistens schneller 🩷`;

    case "opening_hours":
      return [
        `Unser Studio ist **${c.opening_hours_text}** für dich da 🩷`,
        "",
        `📍 ${c.address_oneline}`,
        "",
        c.booking_note,
      ].join("\n");

    case "general_contact":
      return [
        "Du erreichst uns am besten so 🩷",
        "",
        `💬 **WhatsApp:** ${c.whatsapp_number}`,
        `📧 **E-Mail:** ${c.email}`,
        `📍 **Studio Bremen:** ${c.address_oneline} (${c.opening_hours_text})`,
        `🌐 **Instagram:** ${c.instagram_handle}`,
      ].join("\n");

    default:
      return ""; // sollte nie erreicht werden — Caller prüft auf null
  }
}

/**
 * Validiert NACH der LLM-Antwort dass alle Kontakt-Infos die der Bot
 * eventuell genannt hat, mit der Config matchen. Falls nicht: replace.
 *
 * Wird als Post-Sanitizer eingesetzt (zusätzlich zum Intent-Bypass).
 * Schutz vor LLM-Halluzination bei nicht-Bypass-Pfaden.
 */
/**
 * STRUKTURELLE INVARIANTE: Bot-Output darf KEINE unautorisierte Kontakt-Info enthalten.
 *
 * Ein einziger generischer Check für jede Pattern-Klasse (Adresse / Telefon / Email):
 *   - erkennt ANY Pattern dieser Klasse
 *   - prüft ob es EXAKT die Config-Werte sind
 *   - wenn nicht: durch Config-Werte ersetzen (deterministisch)
 *
 * KEINE Enumeration von Straßen-Endungen, Festnetz-Vorwahlen, Email-Aliassen.
 * Pattern auf Struktur-Ebene — nicht auf String-Ebene.
 */
export function enforceBusinessFacts(text: string): { text: string; changed: boolean } {
  const c = BUSINESS_CONFIG;
  let changed = false;
  let out = text;

  // ADRESSE Pattern A — Vollform "<Straße> <Nr>[,] <PLZ> <Stadt>"
  const anyAddress = /\b([A-ZÄÖÜ][^\n,;]{2,60}?)\s+(\d{1,4}[a-z]?),?\s*(\d{5})\s+([A-ZÄÖÜ][\wäöüß.-]+)\b/gi;
  out = out.replace(anyAddress, (match) => {
    if (match === c.address_oneline) return match;
    changed = true;
    console.warn(`[enforceBusinessFacts] Adresse A blockiert (${match}) → ${c.address_oneline}`);
    return c.address_oneline;
  });

  // SIBLING-SWEEP — ADRESSE Pattern B: "<Straße>-Suffix <Nr>" OHNE PLZ
  // Bug-Fall: Bot schreibt "Hans-Böckler-Straße 59 in Bremen" (falsche Hausnummer)
  //   ↑ Pattern A matched NICHT weil PLZ fehlt → ging durch.
  // Pattern B matched JEDE Straße+Hausnummer; ersetzt nur den Adress-Teil, nicht die
  // umgebende Stadt-Nennung — sonst entsteht "Hans-Böckler-Straße 60, 28217 Bremen in Bremen".
  // `i`-Flag: damit "Parkallee" (lowercase "allee") auch matched gegen "Allee" in Alternation.
  const streetWithNumNoPlz = /\b([A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ.-]{1,50}?(?:Straße|Strasse|Str\.|Allee|Weg|Platz|Ring|Gasse|Gässchen|Chaussee|Wende|Pfad|Ufer|Damm|Stieg|Twiete|Markt|Park|Hof))\s+(\d{1,4}[a-z]?)\b/gi;
  out = out.replace(streetWithNumNoPlz, (match, street, num) => {
    const normMatch = `${street} ${num}`.toLowerCase().replace(/ß/g, "ss").replace(/\s+/g, " ").trim();
    const normReal = c.street.toLowerCase().replace(/ß/g, "ss").replace(/\s+/g, " ").trim();
    if (normMatch === normReal) return match;
    changed = true;
    console.warn(`[enforceBusinessFacts] Adresse B blockiert (${match}) → ${c.street}`);
    return c.street; // nur Straße+Nr, NICHT ganze Adresse — Stadt bleibt im Kontext
  });

  // SIBLING-SWEEP — ADRESSE Pattern C: Straße OHNE Hausnummer, OHNE PLZ
  // Bug-Fall: "wir sind in der Parkallee" (Bot lässt Hausnummer weg, falsche Straße)
  // Match nur Bindestrich-Komposita ("Hans-Böckler-Straße") — vermeidet Generika
  // wie "Hauptstraße", "Bahnhofstraße". Falls Bot eine ungewöhnliche Straße
  // ohne Bindestrich nennt: bleibt unverändert (akzeptabler False-Negative-Tradeoff).
  const streetOnlyNoNum = /\b([A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ]{2,30}(?:-[A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ]{2,30})*-(?:Straße|Strasse|Str\.|Allee|Weg|Platz|Ring|Gasse|Gässchen|Chaussee|Wende|Pfad|Ufer|Damm|Stieg|Twiete|Markt|Park|Hof))\b/gi;
  out = out.replace(streetOnlyNoNum, (match) => {
    const normMatch = match.toLowerCase().replace(/ß/g, "ss").trim();
    const realStreetOnly = c.street.replace(/\s+\d.*$/, "").toLowerCase().replace(/ß/g, "ss").trim();
    if (normMatch === realStreetOnly || normMatch.includes(realStreetOnly.slice(0,15))) return match;
    changed = true;
    console.warn(`[enforceBusinessFacts] Adresse C blockiert (${match}) → ${c.street}`);
    return c.street;
  });

  // TELEFON — strukturell: jede zusammenhängende Ziffern-Sequenz die wie eine
  // deutsche Telefonnummer aussieht. Egal welches Format (Spaces, Slash,
  // Bindestrich, Klammern). Wir extrahieren nur die Ziffern und prüfen.
  // Range 8-14 Ziffern: deckt deutsche Festnetz + Handy + mit/ohne +49 ab.
  const anyPhonePattern = /\b\+?[\d\s\/\-.()]{8,20}\b/g;
  const ourDigits = c.whatsapp_number.replace(/\D/g, "");
  out = out.replace(anyPhonePattern, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 14) return match; // keine Phone-Nummer
    // Akzeptiere wenn Ziffern exakt unsere sind (mit/ohne Länderpräfix 49)
    if (digits === ourDigits) return match;
    if (digits === "49" + ourDigits.slice(1)) return match;
    changed = true;
    console.warn(`[enforceBusinessFacts] Telefon blockiert (${match} → digits=${digits}) → WhatsApp ${c.whatsapp_number}`);
    return `WhatsApp ${c.whatsapp_number}`;
  });

  // EMAIL — strukturell: jede @hairvenly.de Adresse.
  const anyHairvenlyEmail = /\b[a-z0-9._%+-]+@hairvenly\.de\b/gi;
  out = out.replace(anyHairvenlyEmail, (match) => {
    if (match.toLowerCase() === c.email) return match;
    changed = true;
    console.warn(`[enforceBusinessFacts] Email blockiert (${match}) → ${c.email}`);
    return c.email;
  });

  return { text: out, changed };
}
