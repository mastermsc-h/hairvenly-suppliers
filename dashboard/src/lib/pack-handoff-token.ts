import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * Zeitlich begrenzter Zugangs-Token für den Foto-Handoff (iMac → iPhone).
 *
 * Zweck: Das iPhone soll das Beweisfoto OHNE Login hochladen können. Der QR
 * steht nur auf dem iMac-Bildschirm (nicht auf dem gedruckten Lieferschein).
 *
 * Eigenschaften:
 *  - Gilt für GENAU EINE Pack-Session (sessionId im Payload)
 *  - Erlaubt NUR Foto-Upload (die Verify-Funktion wird nur dort benutzt)
 *  - Läuft nach TTL ab (Default 2h)
 *  - Trägt den Aussteller (issuerId = iMac-Nutzer) → Foto wird ihm zugeschrieben
 *  - HMAC-SHA256, Schlüssel aus SUPABASE_SERVICE_ROLE_KEY abgeleitet → kein
 *    neuer Env-Eintrag bei Vercel nötig. Kein DB-Eintrag, kein Cron.
 *
 * Format: base64url(sessionId.issuerId.expMs) + "." + base64url(hmac)
 */

const TTL_MS_DEFAULT = 2 * 60 * 60 * 1000;

function key(): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt");
  return createHash("sha256").update(`${base}:pack-handoff-v1`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function mintHandoffToken(
  sessionId: string,
  issuerId: string,
  ttlMs = TTL_MS_DEFAULT,
): string {
  const exp = Date.now() + ttlMs;
  const payload = `${sessionId}.${issuerId}.${exp}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

export type HandoffClaims = { sessionId: string; issuerId: string; exp: number };

/** Gibt die Claims zurück oder null (ungültig/abgelaufen/manipuliert). */
export function verifyHandoffToken(token: string): HandoffClaims | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const payloadB64 = token.slice(0, dot);
    const sigGiven = token.slice(dot + 1);
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const sigExpected = sign(payload);
    const a = Buffer.from(sigGiven);
    const b = Buffer.from(sigExpected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const parts = payload.split(".");
    if (parts.length !== 3) return null;
    const [sessionId, issuerId, expStr] = parts;
    const exp = Number(expStr);
    if (!sessionId || !issuerId || !Number.isFinite(exp)) return null;
    if (Date.now() > exp) return null;
    return { sessionId, issuerId, exp };
  } catch {
    return null;
  }
}
