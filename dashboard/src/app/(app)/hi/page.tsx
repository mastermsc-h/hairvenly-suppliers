import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import HiChat from "@/components/hi/hi-chat";

export const metadata = { title: "Hi · Hairvenly Intelligence" };

export default async function HiPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  return <HiChat variante="seite" />;
}
