/**
 * Meta Graph API — Send-Funktionen für Instagram + WhatsApp Cloud API
 *
 * ENV-Variablen (Vercel):
 * - META_VERIFY_TOKEN           — Webhook-Verification Token (frei wählbar, gleicher wert in Meta-App)
 * - META_PAGE_ACCESS_TOKEN      — Long-Lived Access Token für Page+Instagram
 * - META_INSTAGRAM_USER_ID      — Instagram Business Account ID
 * - META_APP_SECRET             — App Secret für Webhook-Signature-Verifizierung
 * - WHATSAPP_PHONE_NUMBER_ID    — WhatsApp Phone Number ID (falls WA Cloud API direkt)
 */

const GRAPH_VERSION = "v21.0";

interface SendResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

/** Sendet eine Instagram-DM an einen User */
export async function sendInstagramMessage(
  recipientIgId: string,
  text: string,
): Promise<SendResult> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const igUserId = process.env.META_INSTAGRAM_USER_ID;
  if (!token || !igUserId) {
    return { success: false, error: "META_PAGE_ACCESS_TOKEN or META_INSTAGRAM_USER_ID not set" };
  }
  // IGAA-Tokens (Instagram Login) → graph.instagram.com / EAA → graph.facebook.com
  const host = token.startsWith("IGAA") ? "https://graph.instagram.com" : "https://graph.facebook.com";
  try {
    const res = await fetch(`${host}/${GRAPH_VERSION}/${igUserId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recipient: { id: recipientIgId },
        message:   { text },
      }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error?.message || `HTTP ${res.status}` };
    return { success: true, message_id: data.message_id };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/** Sendet eine WhatsApp-Nachricht via Cloud API */
export async function sendWhatsAppMessage(
  recipientPhone: string,
  text: string,
): Promise<SendResult> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    return { success: false, error: "META_PAGE_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set" };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to:                recipientPhone,
        type:              "text",
        text:              { body: text },
      }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error?.message || `HTTP ${res.status}` };
    return { success: true, message_id: data.messages?.[0]?.id };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/** Resolved IGSID (Instagram-Scoped ID aus Webhook) zu Username via Graph API */
export async function getInstagramUsername(igsid: string): Promise<string | null> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) return null;
  const host = token.startsWith("IGAA") ? "https://graph.instagram.com" : "https://graph.facebook.com";
  try {
    const res = await fetch(
      `${host}/${GRAPH_VERSION}/${igsid}?fields=username,name&access_token=${encodeURIComponent(token)}`,
    );
    const data = await res.json();
    if (!res.ok) {
      console.warn("[meta] getInstagramUsername failed:", data.error?.message);
      return null;
    }
    return data.username || data.name || null;
  } catch (e) {
    console.warn("[meta] getInstagramUsername error:", (e as Error).message);
    return null;
  }
}

/** Verifiziert Meta-Webhook-Signature (X-Hub-Signature-256 Header) */
export async function verifyMetaSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true; // Wenn nicht konfiguriert: skip (NICHT für Production!)
  const expectedSig = signatureHeader.replace("sha256=", "");
  // Web Crypto API für HMAC-SHA256
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return computed === expectedSig;
}
// trigger redeploy 1778943835
