import { requireAdmin } from "@/lib/auth";
import TrainingUI from "./training-ui";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  await requireAdmin();
  return <TrainingUI />;
}
