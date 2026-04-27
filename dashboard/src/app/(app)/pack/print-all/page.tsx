import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fetchUnfulfilledPaidOrders } from "@/lib/shopify";
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

export default async function PrintAllPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");

  const orders = await fetchUnfulfilledPaidOrders(100);

  // Daten für den Client vorbereiten — pro Item ein isExtension-Flag
  const slips = orders.map((o) => ({
    name: o.name,
    numberClean: o.numberClean,
    createdAt: o.createdAt,
    shippingAddress: o.shippingAddress,
    items: o.lineItems.map((li) => ({
      title: li.title,
      variantTitle: li.variantTitle,
      quantity: li.quantity,
      imageUrl: li.imageUrl,
      isExtension: isExtensionItem(li.collectionHandles),
    })),
  }));

  return <PrintAllClient slips={slips} />;
}
