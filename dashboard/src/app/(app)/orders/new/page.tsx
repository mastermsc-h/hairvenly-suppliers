import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import NewOrderForm from "./form";
import type { Supplier } from "@/lib/types";

export default async function NewOrderPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: suppliers } = await supabase.from("suppliers").select("*").order("sort_order").order("name");

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/orders" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Bestellungen
      </Link>
      <h1 className="text-2xl font-semibold text-neutral-900 mt-2 mb-6">Neue Bestellung</h1>
      <NewOrderForm suppliers={(suppliers ?? []) as Supplier[]} />
    </div>
  );
}
