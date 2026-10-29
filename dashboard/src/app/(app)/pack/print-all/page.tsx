import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fetchOrdersForPrintAll } from "@/lib/shopify";
import { createClient } from "@/lib/supabase/server";
import { isExtensionTitle } from "@/lib/item-classify";
import PrintAllClient from "./print-all-client";

export const dynamic = "force-dynamic";


export default async function PrintAllPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");

  const { order: singleOrder } = await searchParams;

  const orders = await fetchOrdersForPrintAll(50);

  // Einzeldruck: nur die angeforderte Bestellung (per ?order=<nummer>) —
  // druckt IMMER, auch wenn schon gedruckt (bewusster Nachdruck).
  // Massendruck: bereits gedruckte Lieferscheine auslassen, sonst landet bei
  // jedem "Alle drucken" der Stapel liegengebliebener Bestellungen erneut im
  // Drucker. Nachdruck geht einzeln, oder per "Druck reset" in der Übersicht.
  let filtered = orders;
  let skippedPrinted: string[] = [];
  if (singleOrder) {
    filtered = orders.filter((o) => o.numberClean === singleOrder.replace(/^#/, ""));
  } else if (orders.length > 0) {
    const supabase = await createClient();
    const { data: printed } = await supabase
      .from("printed_slips")
      .select("order_name")
      .in("order_name", orders.map((o) => o.name));
    const printedSet = new Set((printed ?? []).map((p) => p.order_name));
    skippedPrinted = orders.filter((o) => printedSet.has(o.name)).map((o) => o.name);
    filtered = orders.filter((o) => !printedSet.has(o.name));
  }

  // Daten für den Client vorbereiten — pro Item ein isExtension-Flag
  const slips = filtered.map((o) => ({
    name: o.name,
    numberClean: o.numberClean,
    createdAt: o.createdAt,
    subtotalPrice: o.subtotalPrice,
    totalDiscounts: o.totalDiscounts,
    shippingPrice: o.shippingPrice,
    totalPrice: o.totalPrice,
    currency: o.currency,
    shippingAddress: o.shippingAddress,
    items: o.lineItems.map((li) => ({
      title: li.title,
      variantTitle: li.variantTitle,
      quantity: li.quantity,
      isExtension: isExtensionTitle(li.title, li.collectionHandles),
      unitPrice: li.unitPrice,
      lineTotal: li.lineTotal,
    })),
  }));

  return <PrintAllClient slips={slips} skippedPrinted={skippedPrinted} />;
}
