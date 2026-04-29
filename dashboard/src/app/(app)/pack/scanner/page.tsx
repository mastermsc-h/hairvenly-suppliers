import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { type Locale } from "@/lib/i18n";
import ScannerClient from "./scanner-client";

export const dynamic = "force-dynamic";

export default async function ScannerPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;
  return <ScannerClient locale={locale} />;
}
