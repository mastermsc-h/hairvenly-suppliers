import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fetchOrdersForPrintAll } from "@/lib/shopify";
import PrintAllClient from "./print-all-client";

export const dynamic = "force-dynamic";

const SKIP_HANDLES = new Set([
  "accessoires-werkzeuge",
  "extensions-zubehoer",
  "blessed-haarpflege",
  "haarpflegeprodukte",
  "sonstige-haarpflege",
  "extensions-schulungen",
]);

function isExtensionItem(handles: string[] | undefined): boolean {
  if (!handles || handles.length === 0) return true;
  return !handles.some((h) => SKIP_HANDLES.has(h));
}

export default async function PrintAllPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");

  const { order: singleOrder } = await searchParams;

  const orders = await fetchOrdersForPrintAll(50);

  // Einzeldruck: nur die angeforderte Bestellung (per ?order=<nummer>)
  const filtered = singleOrder
    ? orders.filter((o) => o.numberClean === singleOrder.replace(/^#/, ""))
    : orders;

  // Daten für den Client vorbereiten — pro Item ein isExtension-Flag
  const slips = filtered.map((o) => ({
    name: o.name,
    numberClean: o.numberClean,
    createdAt: o.createdAt,
    totalPrice: o.totalPrice,
    currency: o.currency,
    shippingAddress: o.shippingAddress,
    items: o.lineItems.map((li) => ({
      title: li.title,
      variantTitle: li.variantTitle,
      quantity: li.quantity,
      isExtension: isExtensionItem(li.collectionHandles),
      unitPrice: li.unitPrice,
      lineTotal: li.lineTotal,
    })),
  }));

  return <PrintAllClient slips={slips} />;
}
