import { requireFeature } from "@/lib/auth";
import { fetchAccessoryGroups } from "@/lib/shopify";
import { getPrintedSummary } from "@/lib/actions/printed-labels";
import ZubehoerClient from "./zubehoer-client";

export const dynamic = "force-dynamic";

export default async function ZubehoerPage() {
  await requireFeature("stock");

  const [groups, printedSummary] = await Promise.all([
    fetchAccessoryGroups(),
    getPrintedSummary(),
  ]);

  return <ZubehoerClient groups={groups} printedSummary={printedSummary} />;
}
