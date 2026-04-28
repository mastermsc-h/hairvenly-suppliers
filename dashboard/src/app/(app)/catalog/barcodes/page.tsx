import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fetchAllVariantsForBarcodes, fetchAllCollectionHandles } from "@/lib/shopify";
import BarcodesClient from "./barcodes-client";

export const dynamic = "force-dynamic";

export default async function BarcodesPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "catalog")) redirect("/");

  const [variants, collections] = await Promise.all([
    fetchAllVariantsForBarcodes(),
    fetchAllCollectionHandles(),
  ]);

  // Nur Collections behalten, in denen mind. eine Variante existiert
  const usedHandles = new Set(variants.flatMap((v) => v.collectionHandles));
  const availableCollections = collections.filter((c) => usedHandles.has(c.handle));

  return <BarcodesClient variants={variants} collections={availableCollections} />;
}
