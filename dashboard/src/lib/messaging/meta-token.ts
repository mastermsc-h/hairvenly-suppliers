import { createServiceClient } from "@/lib/supabase/server";

/**
 * Liefert den aktuell gültigen Meta/Instagram Access Token.
 *
 * Reihenfolge:
 *   1. DB (Tabelle meta_token) — wird vom täglichen Cron erneuert
 *   2. Fallback: process.env.META_PAGE_ACCESS_TOKEN (Bootstrap / falls DB leer)
 *
 * In-Memory-Cache (5 Min) pro Serverless-Instanz, damit nicht jede
 * Nachricht einen DB-Read auslöst. Nach einem Refresh im Cron leert der
 * Cron seinen eigenen Cache; andere Instanzen ziehen spätestens nach 5 Min
 * nach (der alte Token bleibt in der Überlappung gültig).
 */
let cache: { token: string; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function getMetaToken(): Promise<string | undefined> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.token;
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from("meta_token")
      .select("access_token")
      .eq("id", 1)
      .maybeSingle();
    if (data?.access_token) {
      cache = { token: data.access_token, at: now };
      return data.access_token;
    }
  } catch {
    // DB nicht erreichbar → Env-Fallback unten
  }
  return process.env.META_PAGE_ACCESS_TOKEN;
}

/** Cache invalidieren (nach einem Refresh im Cron). */
export function clearMetaTokenCache(): void {
  cache = null;
}
