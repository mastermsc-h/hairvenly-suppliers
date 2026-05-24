/**
 * BUSINESS CONFIG — die einzige Quelle der Wahrheit für statische Hairvenly-Daten.
 *
 * Diese Daten dürfen NIE vom LLM formuliert oder erfunden werden. Sie kommen
 * direkt aus dieser Config in Template-Antworten ODER werden post-LLM via
 * Sanitizer gegen das LLM-Output geprüft.
 *
 * Wenn sich etwas ändert (z.B. neue Adresse, andere Öffnungszeiten):
 * HIER ändern, sonst nirgendwo.
 */
export const BUSINESS_CONFIG = {
  studio_name: "Hairvenly Studio Bremen",
  brand_name: "Hairvenly",
  website: "hairvenly.de",
  website_url: "https://hairvenly.de",
  planity_url: "https://www.planity.com/de-DE/hairvenly-28217-bremen",

  // Physische Adresse
  street: "Hans-Böckler-Straße 60",
  postal_code: "28217",
  city: "Bremen",
  address_oneline: "Hans-Böckler-Straße 60, 28217 Bremen",

  // Öffnungszeiten
  opening_hours_text: "Mo-Fr 10-18 Uhr",
  opening_days: "Mo-Fr",
  opening_start_hour: 10,
  opening_end_hour: 18,
  closed_days: ["Samstag", "Sonntag"],

  // Kontakt-Kanäle (in Priorität — WhatsApp ist primär)
  whatsapp_number: "0173 8000865",
  whatsapp_url: "https://wa.me/491738000865",
  email: "kontakt@hairvenly.de",
  instagram_handle: "@hairvenly",
  instagram_url: "https://instagram.com/hairvenly",

  // Versand
  shipping_carrier: "DHL",
  shipping_free_threshold_eur: 150,
  shipping_days_min: 1,
  shipping_days_max: 2,

  // Soft-Hinweis bei Spontan-Vorbeikommen. Bewusst NICHT als Pflicht
  // formuliert — sondern als hilfreicher Tipp für Anfahrten von weiter weg.
  // User-Feedback 2026-05: "Bitte vorher melden" klingt zu sehr nach Muss.
  booking_note: "Wenn du von weiter weg kommst und nicht umsonst herfahren willst, frag vorher kurz nach, ob wir deine Wunschfarbe da haben — wenn dir das wichtig ist.",
} as const;

export type BusinessConfig = typeof BUSINESS_CONFIG;
