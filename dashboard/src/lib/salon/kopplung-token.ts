import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Kurzlebiger Link, mit dem der Admin ein Handy/iPad für die Einnahmen-Erfassung
 * freischaltet (setzt das salon_device-Cookie) — ohne Login und ohne dass jemand
 * den Pairing-Code abtippt. Der QR steht nur im Admin-Dashboard.
 * Format wie pack-handoff-token: base64url(payload) + "." + HMAC (Schlüssel aus dem
 * Service-Role-Key abgeleitet, eigener Zweck → nicht mit anderen Tokens austauschbar).
 */
const TTL_MS = 15 * 60 * 1000;

function sign(payload: string): string {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt");
  const key = createHash("sha256").update(`${base}:salon-kopplung-v1`).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function mintKopplungToken(issuerId: string): string {
  const payload = `kopplung.${issuerId}.${Date.now() + TTL_MS}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

export function verifyKopplungToken(token: string): { issuerId: string; exp: number } | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
    const a = Buffer.from(token.slice(dot + 1));
    const b = Buffer.from(sign(payload));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [art, issuerId, expStr] = payload.split(".");
    const exp = Number(expStr);
    if (art !== "kopplung" || !issuerId || !Number.isFinite(exp) || Date.now() > exp) return null;
    return { issuerId, exp };
  } catch {
    return null;
  }
}
