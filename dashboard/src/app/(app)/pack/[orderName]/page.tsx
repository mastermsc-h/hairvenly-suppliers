import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { fetchOrderForPack } from "@/lib/shopify";
import { createClient } from "@/lib/supabase/server";
import { getOrCreatePackSession } from "@/lib/actions/pack";
import PackMode from "./pack-mode";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface ExpectedItem {
  variantId: string | null;
  barcode: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  imageUrl: string | null;
}

export default async function PackOrderPage({
  params,
}: {
  params: Promise<{ orderName: string }>;
}) {
  const { orderName } = await params;
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;

  const order = await fetchOrderForPack(orderName);
  if (!order) notFound();

  // Session anlegen oder laden
  const { sessionId, status, expectedItems } = await getOrCreatePackSession(orderName);

  // Bereits erfolgreiche Scans laden, um initialen Counter aufzubauen
  const supabase = await createClient();
  const { data: matchScans } = await supabase
    .from("pack_scans")
    .select("scanned_barcode")
    .eq("session_id", sessionId)
    .eq("status", "match");

  const initialCounts: Record<string, number> = {};
  for (const s of matchScans ?? []) {
    initialCounts[s.scanned_barcode] = (initialCounts[s.scanned_barcode] ?? 0) + 1;
  }

  // Vorhandene Fotos laden — mehrere pro Typ möglich
  const { data: photos } = await supabase
    .from("pack_photos")
    .select("id, photo_type, storage_path, taken_at")
    .eq("session_id", sessionId)
    .order("taken_at", { ascending: true });

  const photoMap: Record<string, { id: string; url: string }[]> = {};
  for (const p of photos ?? []) {
    const { data: signed } = await supabase.storage
      .from("pack-photos")
      .createSignedUrl(p.storage_path, 60 * 60);
    if (signed?.signedUrl) {
      if (!photoMap[p.photo_type]) photoMap[p.photo_type] = [];
      photoMap[p.photo_type].push({ id: p.id, url: signed.signedUrl });
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/pack"
            className="text-neutral-500 hover:text-neutral-900 transition"
            aria-label="Zurück zur Liste"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="text-xs text-neutral-500">{t(locale, "shipping.title")}</div>
            <h1 className="text-2xl font-semibold text-neutral-900">
              {order.name} — {order.customerName ?? ""}
            </h1>
          </div>
        </div>
      </header>

      <PackMode
        sessionId={sessionId}
        initialStatus={status}
        orderName={order.name}
        expectedItems={expectedItems as ExpectedItem[]}
        initialCounts={initialCounts}
        initialPhotos={photoMap}
        shippingAddress={order.shippingAddress}
        locale={locale}
      />
    </div>
  );
}
