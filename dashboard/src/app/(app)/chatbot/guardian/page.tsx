import { requireAdmin } from "@/lib/auth";
import GuardianClient from "./guardian-client";

export const dynamic = "force-dynamic";

export default async function GuardianPage() {
  await requireAdmin();
  return <GuardianClient />;
}
