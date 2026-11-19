import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import Tresor from "./tresor";

export const metadata = { title: "Passwörter" };
export const dynamic = "force-dynamic";

export default async function PasswoerterPage() {
  // Nur echte Admins (Mitarbeiter haben is_admin=true, kommen hier aber nicht rein).
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <Tresor />
    </div>
  );
}
