import { requireFeature } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { FileText } from "lucide-react";

export default async function TransfersPage() {
  const profile = await requireFeature("finances");
  const locale = (profile.language ?? "de") as Locale;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t(locale, "finance.transfers.title")}</h1>
        <p className="text-sm text-neutral-500 mt-1">{t(locale, "finance.transfers.subtitle")}</p>
      </div>
      <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm flex flex-col items-center justify-center gap-4 text-center min-h-[300px]">
        <FileText size={48} className="text-neutral-300" />
        <p className="text-neutral-500">{t(locale, "finance.transfers.coming_soon")}</p>
      </div>
    </div>
  );
}
