/**
 * Chatbot-Settings-Reader.
 *
 * Single Source of Truth für globale Bot-Flags. Wird von Webhook und
 * Server-Actions aufgerufen, um proaktive Bot-Trigger zu blockieren
 * wenn der Kill-Switch aktiv ist.
 *
 * User-Anweisung 2026-05-24: "Keine Entwürfe mehr im Voraus durch den
 * Autobot bis das Kostenproblem unter Kontrolle ist."
 *
 * Wieder einschalten:
 *   UPDATE chatbot_settings SET proactive_generation_enabled = true;
 */
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Returns true wenn proaktive Bot-Generierung (Webhook-triggered Drafts
 * oder Auto-Sends) erlaubt ist. False wenn der Kill-Switch aktiv ist —
 * dann läuft NUR noch manuelles Generieren via "Antwort generieren"-Button.
 *
 * Bei DB-Fehler: konservativ true (vermeidet, dass der Bot komplett
 * tot ist, falls die Settings-Tabelle nicht erreichbar ist).
 */
export async function isProactiveGenerationEnabled(): Promise<boolean> {
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from("chatbot_settings")
      .select("proactive_generation_enabled")
      .eq("id", 1)
      .maybeSingle();
    // Default true — falls Spalte fehlt oder Row nicht existiert
    if (data == null) return true;
    return data.proactive_generation_enabled !== false;
  } catch (e) {
    console.warn("[settings] proactive-generation read failed:", (e as Error).message);
    return true; // konservativ: erlauben statt blockieren
  }
}
