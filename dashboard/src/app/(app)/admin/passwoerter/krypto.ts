// Browser-Kryptografie für den Passwort-Tresor (Web Crypto API).
// Master-Passwort → PBKDF2-SHA256 (600.000 Runden) → AES-GCM-256-Schlüssel.
// Der Schlüssel ist nicht exportierbar und verlässt den Browser nie.

export const PRUEFTEXT = "hairvenly-tresor-v1";
export const ITERATIONEN = 600_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function zuB64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

export function vonB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function zufall(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function leiteSchluesselAb(passwort: string, saltB64: string, iterationen: number): Promise<CryptoKey> {
  const basis = await crypto.subtle.importKey("raw", enc.encode(passwort), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: vonB64(saltB64), iterations: iterationen, hash: "SHA-256" },
    basis,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function verschluessele(schluessel: CryptoKey, text: string): Promise<{ iv: string; chiffre: string }> {
  const iv = zufall(12);
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, schluessel, enc.encode(text));
  return { iv: zuB64(iv), chiffre: zuB64(new Uint8Array(c)) };
}

/** Wirft, wenn der Schlüssel falsch ist (GCM-Authentifizierung schlägt fehl). */
export async function entschluessele(schluessel: CryptoKey, ivB64: string, chiffreB64: string): Promise<string> {
  const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: vonB64(ivB64) }, schluessel, vonB64(chiffreB64));
  return dec.decode(p);
}

/** Zufallspasswort ohne verwechselbare Zeichen (0/O, 1/l/I). */
export function erzeugePasswort(laenge = 20): string {
  const zeichen = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_+=?";
  const max = 256 - (256 % zeichen.length);
  let out = "";
  while (out.length < laenge) {
    for (const b of zufall(laenge * 2)) {
      if (b < max && out.length < laenge) out += zeichen[b % zeichen.length];
    }
  }
  return out;
}
