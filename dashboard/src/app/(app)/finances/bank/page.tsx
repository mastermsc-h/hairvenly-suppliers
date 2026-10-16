import { requireFeature } from "@/lib/auth";
import { fetchKontoumsaetze } from "@/lib/actions/kontoumsaetze";
import Kontoumsaetze from "./kontoumsaetze";

export const dynamic = "force-dynamic";
// Regel-Änderungen kategorisieren alle Umsätze neu und gleichen den Steuer-Ledger ab.
export const maxDuration = 60;

export default async function BankPage() {
  await requireFeature("finances");
  const jahr = new Date().getFullYear();
  const data = await fetchKontoumsaetze(jahr);
  return <Kontoumsaetze initialJahr={jahr} initialMonat={new Date().getMonth() + 1} initial={data} />;
}
