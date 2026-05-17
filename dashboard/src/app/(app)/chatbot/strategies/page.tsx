import { requireAdmin } from "@/lib/auth";
import StrategiesUI from "./strategies-ui";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  await requireAdmin();
  return <StrategiesUI />;
}
