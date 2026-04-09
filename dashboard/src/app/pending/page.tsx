import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { Clock } from "lucide-react";

export default async function PendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Check if already approved
  const { data: profile } = await supabase
    .from("profiles")
    .select("approved, is_admin")
    .eq("id", user.id)
    .single();

  if (profile?.approved || profile?.is_admin) redirect("/");

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
          <Clock size={24} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Freigabe ausstehend</h1>
          <p className="text-sm text-neutral-500 mt-2">
            Dein Konto wurde erstellt. Ein Administrator muss deinen Zugang erst freigeben, bevor du das Dashboard nutzen kannst.
          </p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm text-neutral-500 hover:text-neutral-900 underline"
          >
            Abmelden
          </button>
        </form>
      </div>
    </main>
  );
}
