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

function schluessel(): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt");
  return createHash("sha256").update(`${base}:salon-kopplung-v1`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", schluessel()).update(payload).digest("base64url");
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

/**
 * Kurzer Freischalt-Code zum Abtippen — für die Home-Bildschirm-App, die auf iOS
 * eigene Cookies hat und den QR-Link (öffnet Safari) deshalb nicht mitbekommt.
 * Zustandslos wie ein TOTP: HMAC über das 15-Minuten-Fenster; gültig sind das
 * aktuelle und das vorige Fenster (also 15–30 Min.). Raten wird in der Action gebremst.
 */
const CODE_ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O/1/I
const CODE_LAENGE = 8;

function codeFuerFenster(fenster: number): string {
  const h = createHmac("sha256", schluessel()).update(`kopplung-code.${fenster}`).digest();
  let code = "";
  for (let i = 0; i < CODE_LAENGE; i++) code += CODE_ZEICHEN[h[i] & 31];
  return code;
}

export function aktuellerKopplungsCode(): string {
  const c = codeFuerFenster(Math.floor(Date.now() / TTL_MS));
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

export function pruefeKopplungsCode(eingabe: string): boolean {
  const norm = eingabe.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (norm.length !== CODE_LAENGE) return false;
  const jetzt = Math.floor(Date.now() / TTL_MS);
  return [jetzt, jetzt - 1].some((f) => timingSafeEqual(Buffer.from(codeFuerFenster(f)), Buffer.from(norm)));
}
