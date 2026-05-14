import { requireAdmin } from "@/lib/auth";
import AvatarsUI from "./avatars-ui";

export const dynamic = "force-dynamic";

export default async function AvatarsPage() {
  await requireAdmin();
  return <AvatarsUI />;
}
