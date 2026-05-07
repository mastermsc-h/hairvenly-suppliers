import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { fetchOrderForPack } from "@/lib/shopify";
import { createClient } from "@/lib/supabase/server";
import { getOrCreatePackSession, type PhotoSkipReason } from "@/lib/actions/pack";
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

  // Demo-modus: orderName beginnt mit DEMO- (oder #DEMO-) → Shopify skippen
  const isDemo = /^#?DEMO-/.test(orderName);

  const supabase = await createClient();

  let orderDisplay: {
    name: string;
    numericId: string;
    customerName: string | null;
    shippingAddress: { name: string | null; address1: string | null; address2: string | null; zip: string | null; city: string | null; country: string | null } | null;
  };
  let shopifyOrderUrl: string | null = null;
  let shopifyLabelUrl: string | null = null;
  let sessionId: string;
  let status: string;
  let expectedItems: ExpectedItem[];
  let photosSkipped: boolean;
  let photosSkipReason: PhotoSkipReason | null;

  if (isDemo) {
    // Demo-session bereits angelegt → direkt aus DB lesen
    const cleanName = orderName.startsWith("#") ? orderName : `#${orderName}`;
    const { data: demoSession } = await supabase
      .from("pack_sessions")
      .select("id, status, expected_items, photos_skipped, photos_skip_reason")
      .eq("order_name", cleanName)
      .maybeSingle();
    if (!demoSession) notFound();
    sessionId = demoSession.id;
    status = demoSession.status;
    expectedItems = (demoSession.expected_items as ExpectedItem[]) ?? [];
    photosSkipped = demoSession.photos_skipped ?? false;
    photosSkipReason = (demoSession.photos_skip_reason as PhotoSkipReason | null) ?? null;

    orderDisplay = {
      name: cleanName,
      numericId: "0",
      customerName: "Demo Test",
      shippingAddress: {
        name: "Demo Tester",
        address1: "Musterstraße 1",
        address2: null,
        zip: "12345",
        city: "Musterstadt",
        country: "Germany",
      },
    };
  } else {
    const order = await fetchOrderForPack(orderName);
    if (!order) notFound();

    // Shopify-Admin-URLs für Post-Fulfill-Hand-off (Rechnung/Lexware + Versandetikett)
    const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN ?? "";
    const shopHandle = shopDomain.replace(/\.myshopify\.com$/, "");
    shopifyOrderUrl = shopHandle
      ? `https://admin.shopify.com/store/${shopHandle}/orders/${order.numericId}`
      : null;
    shopifyLabelUrl = shopHandle && shopDomain
      ? `https://admin.shopify.com/store/${shopHandle}/apps/dhl-shipping/${shopDomain}/createlabel/${order.numericId}?id=${order.numericId}`
      : null;

    const sessionData = await getOrCreatePackSession(orderName);
    sessionId = sessionData.sessionId;
    status = sessionData.status;
    expectedItems = sessionData.expectedItems;
    photosSkipped = sessionData.photosSkipped;
    photosSkipReason = sessionData.photosSkipReason;

    orderDisplay = {
      name: order.name,
      numericId: order.numericId,
      customerName: order.customerName,
      shippingAddress: order.shippingAddress,
    };
  }

  // Bereits erfolgreiche Scans laden, um initialen Counter aufzubauen
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
            <div className="text-xs text-neutral-500">
              {t(locale, "shipping.title")}
              {isDemo && <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[10px] font-bold uppercase">DEMO</span>}
            </div>
            <h1 className="text-2xl font-semibold text-neutral-900">
              {orderDisplay.name} — {orderDisplay.customerName ?? ""}
            </h1>
          </div>
        </div>
      </header>

      <PackMode
        sessionId={sessionId}
        initialStatus={status}
        orderName={orderDisplay.name}
        userName={profile.display_name || profile.username || null}
        expectedItems={expectedItems as ExpectedItem[]}
        initialCounts={initialCounts}
        initialPhotos={photoMap}
        initialPhotosSkipped={photosSkipped}
        initialPhotosSkipReason={photosSkipReason}
        shippingAddress={orderDisplay.shippingAddress}
        shopifyOrderUrl={shopifyOrderUrl}
        shopifyLabelUrl={shopifyLabelUrl}
        locale={locale}
      />
    </div>
  );
}
