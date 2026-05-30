/**
 * Session-Kategorie-Konstanten.
 *
 * Diese Datei darf KEINE "use server"-Direktive haben — sie exportiert
 * non-function values (const + type) die sowohl Server-Actions als auch
 * Client-Components nutzen müssen. In "use server"-Dateien sind nur
 * async-function-Exports erlaubt; const-Exports brechen den
 * Production-Build (bug 2026-05-30, commit c47f61b).
 */

export type SessionCategory =
  | "availability"
  | "pricing"
  | "color_advice"
  | "appointment"
  | "complaint"
  | "order_status"
  | "gewerbe"
  | "partnership"
  | "models"
  | "general";

/** Allowlist aller 10 Session-Kategorien (Validation in setSessionAdditionalCategories,
 *  Dropdown-Optionen in additional-categories-selector). */
export const ALL_SESSION_CATEGORIES: ReadonlyArray<SessionCategory> = [
  "availability",
  "pricing",
  "general",
  "appointment",
  "color_advice",
  "complaint",
  "order_status",
  "gewerbe",
  "partnership",
  "models",
];
