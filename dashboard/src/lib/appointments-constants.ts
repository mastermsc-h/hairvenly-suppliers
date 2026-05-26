/**
 * Konstanten + Types für Termin-Anfragen.
 * Separate Datei (kein "use server"), damit sowohl Server-Actions als auch
 * Client-Components diese Konstanten importieren können.
 */

export type AppointmentServiceType =
  | "beratung_neu"
  | "beratung_farbe"
  | "einarbeitung"
  | "wartung"
  | "anpassung"
  | "entfernung"
  | "sonstiges";

export type AppointmentStatus =
  | "pending" | "confirmed" | "rescheduled" | "cancelled" | "completed";

export const SERVICE_TYPE_LABELS: Record<AppointmentServiceType, string> = {
  beratung_neu:    "Erstberatung",
  beratung_farbe:  "Farbberatung",
  einarbeitung:    "Einarbeitung",
  wartung:         "Wartung / Auffrischung",
  anpassung:       "Schnitt / Anpassung",
  entfernung:      "Entfernung",
  sonstiges:       "Sonstiges",
};
