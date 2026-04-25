import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import ArchiveList from "./archive-list";

export const dynamic = "force-dynamic";

export interface ArchivedSession {
  id: string;
  orderName: string;
  orderNumberClean: string;
  shopifyOrderId: number | null;
  status: string;
  finishedAt: string | null;
  fulfilledAt: string | null;
  startedAt: string | null;
  packedByName: string | null;
  notes: string | null;
  itemCount: number;
  photoCount: number;
}

export default async function ArchivePage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("pack_sessions")
    .select(
      "id, order_name, shopify_order_id, status, started_at, finished_at, fulfilled_at, expected_items, notes, profiles:packed_by(display_name, username)",
    )
    .in("status", ["verified", "shipped"])
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(500);

  // Foto-Counts pro Session laden
  const sessionIds = (rows ?? []).map((r) => r.id);
  const { data: photoRows } = await supabase
    .from("pack_photos")
    .select("session_id")
    .in("session_id", sessionIds.length > 0 ? sessionIds : [""]);
  const photoCounts = new Map<string, number>();
  for (const p of photoRows ?? []) {
    photoCounts.set(p.session_id, (photoCounts.get(p.session_id) ?? 0) + 1);
  }

  const sessions: ArchivedSession[] = (rows ?? []).map((r) => {
    const profileRel = (r as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
    const items = Array.isArray(r.expected_items) ? r.expected_items.length : 0;
    return {
      id: r.id,
      orderName: r.order_name,
      orderNumberClean: r.order_name.replace(/^#/, ""),
      shopifyOrderId: r.shopify_order_id,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      fulfilledAt: r.fulfilled_at,
      packedByName: profileRel?.display_name || profileRel?.username || null,
      notes: r.notes,
      itemCount: items,
      photoCount: photoCounts.get(r.id) ?? 0,
    };
  });

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">
          {t(locale, "shipping.archive_title")}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          {t(locale, "shipping.archive_subtitle")}
        </p>
      </header>
      <ArchiveList sessions={sessions} locale={locale} />
    </div>
  );
}
