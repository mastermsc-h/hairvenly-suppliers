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
  | "email"                // "email?", "mail?"
  | "opening_hours"        // "öffnungszeiten?", "wann habt ihr offen?"
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
  // ("muss ich in die hans-bernhard?", "ist es die parkallee?")
  // Wenn der Kunde einen Straßennamen nennt, der NICHT die echte Adresse ist,
  // muss der Bot KORRIGIEREN — nicht bestätigen mit "Genau, richtig 💕".
  // Erkennung: Straßennamen-Pattern + Frage-Marker, und Name passt NICHT zu Config.
  if (/\b(muss ich|fahre ich|komme ich|kommt man|ist das|sind das|ist es|seid ihr in|liegt das in|heißt es|in die)\b[^.\n]{0,40}\b(stra(ß|ss)e|str\.?|allee|weg|platz|ring|gasse|chaussee)\b/i.test(t) ||
      /\b(stra(ß|ss)e|str\.?|allee|weg|platz|ring|gasse)\b[^.\n]{0,15}(richtig|stimmt|oder)\??/i.test(t)) {
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

  // TELEFON
  if (/\b(telefon|tel\.?[\s\d]|rufnummer|anrufen|nummer|whatsapp.+nummer)\b/i.test(t)) {
    return "phone";
  }

  // E-MAIL
  if (/\b(e[-\s]?mail|mail.adresse|@hairvenly|schreibe.+mail)\b/i.test(t)) {
    return "email";
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
        `Fast 💕 — wir sind tatsächlich in der **${c.street}**, ${c.postal_code} ${c.city}.`,
        "",
        `🕒 ${c.opening_hours_text}`,
        "",
        "Magst du in Google Maps reinschauen? Dort findest du uns sofort.",
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

  // ADRESSE — strukturell: "<Großgeschriebenes-Wort(e)> <Nummer>[,] <5-stellige-PLZ> <Stadt>"
  // Funktioniert für ALLE Städte, ALLE Straßennamen-Endungen.
  // Echte Hairvenly-Adresse ist die EINZIGE die durchgelassen wird.
  const anyAddress = /\b([A-ZÄÖÜ][^\n,;]{2,60}?)\s+(\d{1,4}[a-z]?),?\s*(\d{5})\s+([A-ZÄÖÜ][\wäöüß.-]+)\b/gi;
  out = out.replace(anyAddress, (match, _street, _num, _plz, _city) => {
    if (match === c.address_oneline) return match;
    changed = true;
    console.warn(`[enforceBusinessFacts] Adresse blockiert (${match}) → ${c.address_oneline}`);
    return c.address_oneline;
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
