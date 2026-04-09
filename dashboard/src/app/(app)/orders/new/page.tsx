import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import NewOrderForm from "./form";
import type { Supplier } from "@/lib/types";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier_id?: string }>;
}) {
  const profile = await requireAdmin();
  const locale = (profile.language ?? "de") as Locale;
  const supabase = await createClient();
  const { data: suppliers } = await supabase.from("suppliers").select("*").order("sort_order").order("name");
  const sp = await searchParams;

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/orders" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← {t(locale, "nav.orders")}
      </Link>
      <h1 className="text-2xl font-semibold text-neutral-900 mt-2 mb-6">{t(locale, "new_order.title")}</h1>
      <NewOrderForm
        suppliers={(suppliers ?? []) as Supplier[]}
        locale={locale}
        preselectedSupplierId={sp.supplier_id}
      />
    </div>
  );
}
