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
export function enforceBusinessFacts(text: string): { text: string; changed: boolean } {
  const c = BUSINESS_CONFIG;
  let changed = false;
  let out = text;

  // 1) Falsche Bremen-Adressen → ersetzen.
  // PERMISSIVES Pattern: matched ALLES was wie eine Straßen-Adresse in Bremen
  // aussieht — egal welche Endung (Haferwende, Domshof, Schlachte, Faulenstraße,
  // Wallring, Sögestraße, Parkallee — alle Varianten). Wenn nicht EXAKT
  // Hans-Böckler-Straße 60, 28217 → ersetzen.
  // Strukturell: "<großgeschriebenes Wort+Zusatz> <Nummer>[,] <5-stellige PLZ> Bremen"
  const wrongAddr = /\b([A-ZÄÖÜ][\wäöüß.-]{2,40})\s+(\d{1,4}[a-z]?),?\s*(2\d{4})\s+Bremen\b/gi;
  out = out.replace(wrongAddr, (match, street, num, plz) => {
    const isOurs = /Hans[\s-]?Böckler/i.test(street) && plz === c.postal_code && /^60[a-z]?$/i.test(num);
    if (isOurs) return match;
    changed = true;
    console.warn(`[enforceBusinessFacts] Adresse halluziniert (${match}) → ${c.address_oneline}`);
    return c.address_oneline;
  });

  // 2) Falsche Bremen-Festnetz-Nummern (0421 ...) → WhatsApp
  const wrongPhone = /\b0421[\s\/\-.]*\d{1,3}[\s\/\-.]*\d{1,3}[\s\/\-.]*\d{1,4}(?:[\s\/\-.]*\d{1,3})?\b/g;
  out = out.replace(wrongPhone, (match) => {
    changed = true;
    console.warn(`[enforceBusinessFacts] Telefon halluziniert (${match}) → WhatsApp ${c.whatsapp_number}`);
    return `WhatsApp ${c.whatsapp_number}`;
  });

  // 3) Falsche E-Mail-Aliase → kontakt@
  const wrongEmail = /\b(info|hello|hi|support|service|kontakte|kontak)@hairvenly\.de\b/gi;
  out = out.replace(wrongEmail, (match) => {
    if (match.toLowerCase() === c.email) return match;
    changed = true;
    console.warn(`[enforceBusinessFacts] E-Mail halluziniert (${match}) → ${c.email}`);
    return c.email;
  });

  return { text: out, changed };
}
