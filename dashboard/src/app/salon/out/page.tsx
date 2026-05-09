import { redirect } from "next/navigation";
import { isSalonDevicePaired } from "@/lib/salon/auth";
import { createServiceClient } from "@/lib/supabase/server";
import OutClient from "./out-client";

export const dynamic = "force-dynamic";

export default async function SalonOutPage() {
  if (!(await isSalonDevicePaired())) redirect("/salon");

  const svc = createServiceClient();
  const { data: employees } = await svc
    .from("salon_employees")
    .select("id, name, color")
    .eq("active", true)
    .order("name");

  return <OutClient employees={(employees ?? []).map((e) => ({ id: e.id, name: e.name, color: e.color }))} />;
}
