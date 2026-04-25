import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Camera, CheckCircle2, AlertTriangle } from "lucide-react";
import NotesEditor from "./notes-editor";

const SHOPIFY_STORE_HANDLE = "339520-3";

export const dynamic = "force-dynamic";

export default async function ArchiveDetailPage({
  params,
}: {
  params: Promise<{ orderName: string }>;
}) {
  const { orderName } = await params;
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;
  const localeStr = locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : "en-US";

  const cleanName = orderName.startsWith("#") ? orderName : `#${orderName}`;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("pack_sessions")
    .select(
      "id, order_name, shopify_order_id, status, expected_items, started_at, finished_at, fulfilled_at, notes, profiles:packed_by(display_name, username)",
    )
    .eq("order_name", cleanName)
    .maybeSingle();

  if (!session) notFound();

  const profileRel = (session as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
  const packedByName = profileRel?.display_name || profileRel?.username || null;

  // Foto-URLs holen
  const { data: photos } = await supabase
    .from("pack_photos")
    .select("photo_type, storage_path, taken_at, profiles:taken_by(display_name, username)")
    .eq("session_id", session.id);

  const photoMap: Record<string, { url: string; takenAt: string; takenBy: string | null }> = {};
  for (const p of photos ?? []) {
    const { data: signed } = await supabase.storage
      .from("pack-photos")
      .createSignedUrl(p.storage_path, 60 * 60);
    if (signed?.signedUrl) {
      const ttBy = (p as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
      photoMap[p.photo_type] = {
        url: signed.signedUrl,
        takenAt: p.taken_at,
        takenBy: ttBy?.display_name || ttBy?.username || null,
      };
    }
  }

  // Scan-Audit-Log
  const { data: scans } = await supabase
    .from("pack_scans")
    .select("scanned_barcode, matched_title, status, scanned_at, profiles:scanned_by(display_name, username)")
    .eq("session_id", session.id)
    .order("scanned_at", { ascending: true });

  const expectedItems = Array.isArray(session.expected_items) ? session.expected_items : [];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/pack/archive"
            className="text-neutral-500 hover:text-neutral-900"
            aria-label="Zurück zum Archiv"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="text-xs text-neutral-500">
              {t(locale, "shipping.archive_title")}
            </div>
            <h1 className="text-2xl font-semibold text-neutral-900 flex items-center gap-2">
              {session.order_name}
              {session.shopify_order_id && (
                <a
                  href={`https://admin.shopify.com/store/${SHOPIFY_STORE_HANDLE}/orders/${session.shopify_order_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-400 hover:text-neutral-700"
                  title="In Shopify öffnen"
                >
                  <ExternalLink size={18} />
                </a>
              )}
            </h1>
          </div>
        </div>
        <span
          className={`inline-block px-3 py-1 text-xs font-medium rounded border ${
            session.status === "shipped"
              ? "bg-blue-50 text-blue-800 border-blue-300"
              : "bg-emerald-50 text-emerald-800 border-emerald-300"
          }`}
        >
          {t(locale, `shipping.status_${session.status}`)}
        </span>
      </header>

      {/* Meta-Daten */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-xs font-medium text-neutral-500 uppercase">{t(locale, "shipping.packed_by")}</div>
          <div className="text-sm text-neutral-900 mt-1">{packedByName ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-neutral-500 uppercase">{t(locale, "shipping.archive_started_at")}</div>
          <div className="text-sm text-neutral-900 mt-1">
            {session.started_at
              ? new Date(session.started_at).toLocaleString(localeStr, {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-neutral-500 uppercase">{t(locale, "shipping.archive_finished_at")}</div>
          <div className="text-sm text-neutral-900 mt-1">
            {session.finished_at
              ? new Date(session.finished_at).toLocaleString(localeStr, {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-neutral-500 uppercase">{t(locale, "shipping.archive_fulfilled_at")}</div>
          <div className="text-sm text-neutral-900 mt-1">
            {session.fulfilled_at
              ? new Date(session.fulfilled_at).toLocaleString(localeStr, {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </div>
        </div>
      </div>

      {/* Notizen */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="text-xs font-medium text-neutral-500 uppercase mb-2">
          {t(locale, "shipping.archive_notes")}
        </div>
        <NotesEditor sessionId={session.id} initialNotes={session.notes ?? ""} locale={locale} />
      </div>

      {/* Pack-Beweis Fotos */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="text-xs font-medium text-neutral-500 uppercase mb-3">
          {t(locale, "shipping.pack_proof")}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(["products_invoice", "products_in_box", "package_on_scale"] as const).map((type) => {
            const labelKey =
              type === "products_invoice"
                ? "shipping.photo_invoice"
                : type === "products_in_box"
                ? "shipping.photo_in_box"
                : "shipping.photo_on_scale";
            const photo = photoMap[type];
            return (
              <div key={type} className="border border-neutral-200 rounded-xl overflow-hidden">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={photo.url} target="_blank" rel="noopener noreferrer">
                    <img src={photo.url} alt="" className="w-full h-48 object-cover" />
                  </a>
                ) : (
                  <div className="w-full h-48 bg-neutral-100 flex items-center justify-center">
                    <Camera className="text-neutral-300" size={36} />
                  </div>
                )}
                <div className="p-3 text-xs">
                  <div className="font-medium text-neutral-900">{t(locale, labelKey)}</div>
                  {photo ? (
                    <div className="text-neutral-500 mt-1">
                      {new Date(photo.takenAt).toLocaleString(localeStr, {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {photo.takenBy && ` · ${photo.takenBy}`}
                    </div>
                  ) : (
                    <div className="text-neutral-400 mt-1">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Erwartete Items */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="text-xs font-medium text-neutral-500 uppercase mb-3">
          {t(locale, "shipping.expected_items")}
        </div>
        <div className="space-y-2 text-sm">
          {expectedItems.map((it: { title: string; quantity: number; barcode?: string | null }, idx: number) => (
            <div key={idx} className="flex items-center justify-between border-b border-neutral-100 pb-2 last:border-0">
              <div>
                <div className="text-neutral-900">{it.title}</div>
                {it.barcode && (
                  <div className="text-xs text-neutral-500 font-mono">EAN: {it.barcode}</div>
                )}
              </div>
              <div className="font-bold text-neutral-700">{it.quantity}×</div>
            </div>
          ))}
        </div>
      </div>

      {/* Scan-Audit-Log */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="text-xs font-medium text-neutral-500 uppercase mb-3">
          {t(locale, "shipping.archive_scan_log")} ({scans?.length ?? 0})
        </div>
        <div className="space-y-1 text-sm font-mono max-h-64 overflow-y-auto">
          {(scans ?? []).map((s, idx) => {
            const sBy = (s as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
            const byName = sBy?.display_name || sBy?.username || "—";
            const isMatch = s.status === "match";
            return (
              <div
                key={idx}
                className={`flex items-center gap-3 px-3 py-1.5 rounded ${
                  isMatch ? "bg-emerald-50/60" : "bg-red-50/60"
                }`}
              >
                {isMatch ? (
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle size={14} className="text-red-600 shrink-0" />
                )}
                <span className="text-xs text-neutral-500 w-32 shrink-0">
                  {new Date(s.scanned_at).toLocaleTimeString(localeStr, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className="text-neutral-700 w-24 shrink-0 truncate">{s.scanned_barcode}</span>
                <span className="text-neutral-900 flex-1 truncate">{s.matched_title ?? "—"}</span>
                <span className="text-xs text-neutral-500 shrink-0">{byName}</span>
              </div>
            );
          })}
          {(!scans || scans.length === 0) && (
            <div className="text-neutral-400 italic px-3">Keine Scans im Log.</div>
          )}
        </div>
      </div>
    </div>
  );
}
