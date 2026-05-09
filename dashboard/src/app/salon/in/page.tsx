import { redirect } from "next/navigation";
import { isSalonDevicePaired } from "@/lib/salon/auth";
import InClient from "./in-client";

export const dynamic = "force-dynamic";

export default async function SalonInPage() {
  if (!(await isSalonDevicePaired())) redirect("/salon");
  return <InClient />;
}
