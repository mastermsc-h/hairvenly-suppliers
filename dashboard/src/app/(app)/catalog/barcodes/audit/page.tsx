import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fetchAllVariantsForAudit } from "@/lib/shopify";
import { auditBarcodes } from "@/lib/barcode-audit";
import AuditClient from "./audit-client";

export const dynamic = "force-dynamic";

export default async function BarcodeAuditPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "catalog")) redirect("/");

  const variants = await fetchAllVariantsForAudit();
  const report = auditBarcodes(variants);

  // Shop-Domain für Deep-Links zur Shopify-Admin
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN ?? "";

  return <AuditClient report={report} shopDomain={shopDomain} />;
}
