import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cron-Job (Vercel Schedule): löscht Pack-Fotos älter als 180 Tage
 * (für shipped/verified Sessions). Reklamationen sind fast immer in den
 * ersten Wochen — danach Storage-Sparen ist sicher.
 *
 * DB-Records werden gelöscht (storage_path zuerst aus Bucket entfernen).
 * Das Audit-Log (pack_scans, pack_sessions) bleibt vollständig erhalten.
 *
 * Schutz: nur via Vercel Cron oder mit CRON_SECRET-Header aufrufbar.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // Vercel Cron sendet `Bearer <CRON_SECRET>` automatisch wenn konfiguriert
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 180);
  const cutoffIso = cutoff.toISOString();

  // Alle pack_photos zu shipped/verified Sessions, deren Session älter als cutoff
  const { data: oldPhotos } = await supabase
    .from("pack_photos")
    .select("id, storage_path, session_id, pack_sessions!inner(status, finished_at)")
    .lt("pack_sessions.finished_at", cutoffIso)
    .in("pack_sessions.status", ["shipped", "verified"])
    .limit(1000);

  if (!oldPhotos || oldPhotos.length === 0) {
    return NextResponse.json({ deleted: 0, cutoff: cutoffIso });
  }

  const paths = oldPhotos.map((p) => p.storage_path);
  const ids = oldPhotos.map((p) => p.id);

  // Storage-Files löschen
  const { error: storageErr } = await supabase.storage.from("pack-photos").remove(paths);
  if (storageErr) {
    console.error("[cleanup] storage delete error", storageErr);
  }

  // DB-Records löschen
  const { error: dbErr } = await supabase.from("pack_photos").delete().in("id", ids);
  if (dbErr) {
    return NextResponse.json({ error: dbErr.message, partial: paths.length }, { status: 500 });
  }

  return NextResponse.json({
    deleted: paths.length,
    cutoff: cutoffIso,
    sample: paths.slice(0, 3),
  });
}
