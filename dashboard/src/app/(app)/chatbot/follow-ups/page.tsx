import { requireAdmin } from "@/lib/auth";
import FollowUpsClient from "./follow-ups-client";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  await requireAdmin();
  return <FollowUpsClient />;
}
