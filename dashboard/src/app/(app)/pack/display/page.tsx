import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import PackDisplay from "./pack-display";

export const dynamic = "force-dynamic";

export default async function PackDisplayPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;

  // Neueste aktiv gepackte oder gerade fertig gestellte Session
  // (shipped wird hier nicht angezeigt — dann zurück zum Wartebildschirm)
  const supabase = await createClient();
  const { data: activeSessions } = await supabase
    .from("pack_sessions")
    .select("id, order_name, status, expected_items, started_at, finished_at, packed_by, profiles:packed_by(display_name, username)")
    .in("status", ["in_progress", "verified"])
    .order("updated_at", { ascending: false })
    .limit(1);

  const session = activeSessions?.[0] ?? null;
  const initialCounts: Record<string, number> = {};
  if (session) {
    const { data: scans } = await supabase
      .from("pack_scans")
      .select("scanned_barcode")
      .eq("session_id", session.id)
      .eq("status", "match");
    for (const s of scans ?? []) {
      initialCounts[s.scanned_barcode] = (initialCounts[s.scanned_barcode] ?? 0) + 1;
    }
  }

  const profileRel = session
    ? (session as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles
    : null;
  const packedBy = profileRel?.display_name || profileRel?.username || null;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <PackDisplay
        initialSession={
          session
            ? {
                id: session.id,
                orderName: session.order_name,
                status: session.status,
                expectedItems: (session.expected_items as Array<{ barcode: string | null; title: string; variantTitle: string | null; quantity: number; imageUrl: string | null }>) ?? [],
                packedBy,
                startedAt: session.started_at,
                finishedAt: session.finished_at,
              }
            : null
        }
        initialCounts={initialCounts}
        locale={locale}
      />
    </div>
  );
}
