import { requireFeature } from "@/lib/auth";
import { fetchZBonStatus, fetchZBons } from "@/lib/actions/z-bons";
import ZBons from "./z-bons";

export default async function ZBonsPage() {
  await requireFeature("finances");
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const jahr = Number(heute.slice(0, 4));
  const monat = Number(heute.slice(5, 7));
  const [bons, status] = await Promise.all([fetchZBons(jahr, monat), fetchZBonStatus(jahr, monat)]);
  return <ZBons initialJahr={jahr} initialMonat={monat} initialBons={bons} initialStatus={status} heute={heute} />;
}
