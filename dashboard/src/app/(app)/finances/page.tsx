import { redirect } from "next/navigation";
import { requireFeature } from "@/lib/auth";
import { ladeFinanzStart } from "@/lib/finanzen/start";
import FinanzStartAnsicht from "./finanz-start";

export const dynamic = "force-dynamic";

/** Finanz-Startseite: die wichtigsten Zahlen auf einen Blick. */
export default async function FinancesPage() {
  const profile = await requireFeature("finances");
  if (profile.role === "supplier") redirect("/");
  const d = await ladeFinanzStart();
  return <FinanzStartAnsicht d={d} />;
}
