import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import ZubehoerCodeClient from "./zubehoer-code-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zubehör-Scan-Code",
};

export default async function ZubehoerCodePage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  return <ZubehoerCodeClient />;
}
