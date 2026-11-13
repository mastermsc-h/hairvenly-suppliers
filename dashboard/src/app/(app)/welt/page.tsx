import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import WeltLoader from "./welt-loader";

export const metadata = { title: "Hairvenly Welt" };

export default async function WeltPage({
  searchParams,
}: {
  searchParams: Promise<{ bereich?: string }>;
}) {
  // Prototyp mit Beispielzahlen — vorerst nur für den echten Admin.
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const { bereich } = await searchParams;
  return <WeltLoader start={bereich} />;
}
