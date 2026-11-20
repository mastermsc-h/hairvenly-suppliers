import { requireFeature } from "@/lib/auth";
import GewerbeListe from "./gewerbe-liste";
import { ladeGewerbeZeilen } from "./daten";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gewerbekunden · Hairvenly" };

export default async function GewerbePage() {
  await requireFeature("finances");
  const zeilen = await ladeGewerbeZeilen();
  return <GewerbeListe zeilen={zeilen} stand={new Date().toISOString()} />;
}
