import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/auth";
import { fetchAccessoryGroups, ACCESSORY_COLLECTIONS } from "@/lib/shopify";
import { getPrintedSummary } from "@/lib/actions/printed-labels";
import ZubehoerClient from "../zubehoer-client";

export const dynamic = "force-dynamic";

export default async function ZubehoerCollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireFeature("stock");
  const { slug } = await params;

  if (!ACCESSORY_COLLECTIONS.some((c) => c.slug === slug)) notFound();

  const [groups, printedSummary] = await Promise.all([
    fetchAccessoryGroups(),
    getPrintedSummary(),
  ]);

  const filtered = groups.filter((g) => g.slug === slug);
  if (filtered.length === 0) notFound();

  return <ZubehoerClient groups={filtered} printedSummary={printedSummary} singleCollection />;
}
