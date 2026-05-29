/**
 * Chatbot-Settings-Reader.
 *
 * Single Source of Truth für globale Bot-Flags. Wird von Webhook und
 * Server-Actions aufgerufen, um proaktive Bot-Trigger zu blockieren
 * wenn der Kill-Switch aktiv ist.
 *
 * ── EVOLUTION ──
 * 2026-05-24 Phase 1 (0080): Globaler Kill-Switch on/off.
 * 2026-05-26 Phase 2 (0083): Granular — wenn off, dann darf der Bot
 *   trotzdem für "ungefährliche" Categories antworten (Whitelist).
 *   So sind Standard-Anfragen (Verfügbarkeit, allgemein, Preise, Versand)
 *   automatisiert, riskante (Farbberatung, Gewerbe, Termin, Reklamation,
 *   Partnership) bleiben Mitarbeiter-Click only.
 *
 * Logik:
 *   proactive_generation_enabled = TRUE  → immer erlaubt (Legacy)
 *   proactive_generation_enabled = FALSE → erlaubt nur wenn
 *     category ∈ proactive_safe_categories
 *
 * Wieder voll aufmachen:
 *   UPDATE chatbot_settings SET proactive_generation_enabled = true;
 *
 * Bei DB-Fehler: konservativ true (vermeidet, dass der Bot komplett
 * tot ist, falls die Settings-Tabelle nicht erreichbar ist).
 */
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Returns true wenn proaktive Bot-Generierung (Webhook-triggered Drafts
 * oder Auto-Sends) für die gegebene Session-Category erlaubt ist.
 *
 * @param category - chat_sessions.category. null/undefined = unbekannt →
 *   bei vollem Kill-Switch (proactive_generation_enabled=false) wird das
 *   als unsicher behandelt und blockiert.
 */
export async function isProactiveGenerationEnabled(
  category?: string | null,
): Promise<boolean> {
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from("chatbot_settings")
      .select("proactive_generation_enabled, proactive_safe_categories")
      .eq("id", 1)
      .maybeSingle();
    // Default true — falls Spalte fehlt oder Row nicht existiert
    if (data == null) return true;
    // Master-Switch on → alles erlaubt
    if (data.proactive_generation_enabled !== false) return true;
    // Master-Switch off → Whitelist greift
    const safe: string[] = Array.isArray(data.proactive_safe_categories)
      ? data.proactive_safe_categories
      : [];
    if (!category) return false; // unbekannte Category bei Kill-Switch = blockiert
    return safe.includes(category);
  } catch (e) {
    console.warn("[settings] proactive-generation read failed:", (e as Error).message);
    return true; // konservativ: erlauben statt blockieren
  }
}

/**
 * Slim-Prompt-Modus (Feature-Flag).
 *
 * Default false (= klassischer Full-Prompt). Admin schaltet via UI ein.
 *
 * Wenn true: respondAsBot lädt einen kompakten Hard-Rule-Block (~15 Zeilen
 * statt ~70), lässt Training-Beispiele weg, behält nur Top-2-Strategien.
 * Ziel: ~10k statt ~50k Tokens pro Call. Bot wird gleichzeitig schlauer
 * (weniger Lärm) und ~60-70% billiger.
 */
export async function isLeanPromptEnabled(): Promise<boolean> {
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from("chatbot_settings")
      .select("use_lean_prompt")
      .eq("id", 1)
      .maybeSingle();
    return data?.use_lean_prompt === true;
  } catch (e) {
    console.warn("[settings] lean-prompt read failed:", (e as Error).message);
    return false;
  }
}
