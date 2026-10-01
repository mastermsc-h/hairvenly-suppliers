"use server";

import { requireProfile, hasFeature } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { mintHandoffToken, verifyHandoffToken } from "@/lib/pack-handoff-token";

/**
 * Foto-Handoff iMac → iPhone OHNE Login am Handy.
 *
 * Ablauf: Der eingeloggte iMac-Nutzer lässt sich einen signierten, 2h gültigen
 * Link für GENAU DIESE Session ausstellen (createPhotoHandoffLink). Der Link
 * steckt im QR auf dem iMac-Bildschirm. Das iPhone öffnet /pack-foto/<token>
 * (öffentliche Route), macht das Foto und lädt es per uploadPackPhotoByToken
 * hoch — serverseitig mit Service-Client, da kein Nutzer-Login vorhanden ist.
 * Das Foto wird dem Aussteller (iMac-Nutzer) zugeschrieben.
 */

const MAX_BYTES = 10 * 1024 * 1024;

export async function createPhotoHandoffLink(
  sessionId: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) return { success: false, error: "Forbidden" };

  // Session muss existieren und darf nicht schon versendet sein (RLS greift)
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("pack_sessions")
    .select("id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { success: false, error: "Session nicht gefunden" };
  if (session.status === "shipped") return { success: false, error: "Schon versendet" };

  const token = mintHandoffToken(sessionId, profile.id);
  return { success: true, path: `/pack-foto/${token}` };
}

export async function uploadPackPhotoByToken(
  token: string,
  formData: FormData,
): Promise<{ success: boolean; error?: string; count?: number }> {
  const claims = verifyHandoffToken(token);
  if (!claims) return { success: false, error: "Link ungültig oder abgelaufen" };

  const file = formData.get("photo") as File | null;
  if (!file) return { success: false, error: "Keine Datei" };
  if (!file.type.startsWith("image/")) return { success: false, error: "Nur Bilder erlaubt" };
  if (file.size > MAX_BYTES) return { success: false, error: "Bild zu groß (max 10 MB)" };

  const admin = createServiceClient();
  const { data: session } = await admin
    .from("pack_sessions")
    .select("id, status")
    .eq("id", claims.sessionId)
    .maybeSingle();
  if (!session) return { success: false, error: "Session nicht gefunden" };
  if (session.status === "shipped") return { success: false, error: "Bestellung ist schon versendet" };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${claims.sessionId}/products_invoice-${Date.now()}.${ext}`;

  const { error: upErr } = await admin.storage
    .from("pack-photos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { success: false, error: upErr.message };

  const { error: insErr } = await admin.from("pack_photos").insert({
    session_id: claims.sessionId,
    photo_type: "products_invoice",
    storage_path: path,
    // Kein Login am Handy → Foto gehört dem Aussteller des Links (iMac-Nutzer)
    taken_by: claims.issuerId,
  });
  if (insErr) {
    try {
      await admin.storage.from("pack-photos").remove([path]);
    } catch {
      /* best effort — 180d-cleanup räumt notfalls */
    }
    return { success: false, error: insErr.message };
  }

  // updated_at frisch halten (Display-Stale-Fenster) + Polling am iMac sieht es
  await admin
    .from("pack_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", claims.sessionId);

  const { count } = await admin
    .from("pack_photos")
    .select("id", { count: "exact", head: true })
    .eq("session_id", claims.sessionId);

  return { success: true, count: count ?? 1 };
}
