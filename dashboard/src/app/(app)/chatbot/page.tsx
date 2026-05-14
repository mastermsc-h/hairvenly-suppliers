import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import PriceTable from "./price-table";
import FaqEditor from "./faq-editor";
import { Bot, BookOpen, DollarSign } from "lucide-react";
import type { PriceRow } from "@/lib/chatbot/pricing";

export const dynamic = "force-dynamic";

export default async function ChatbotPage() {
  await requireProfile();
  const supabase = await createClient();

  const [{ data: prices }, { data: faqs }] = await Promise.all([
    supabase
      .from("chatbot_prices")
      .select("method, length_cm, gram_label, gram_per_pack, price_eur, supplier_line")
      .eq("active", true)
      .order("method")
      .order("length_cm"),
    supabase
      .from("chatbot_faq")
      .select("*")
      .order("order_idx")
      .order("created_at"),
  ]);

  const priceRows = (prices ?? []) as PriceRow[];
  const activeFaqs = (faqs ?? []).filter(f => f.active).length;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Bot size={20} className="text-neutral-700" />
          <h1 className="text-xl font-semibold text-neutral-900">Chatbot Wissensdatenbank</h1>
        </div>
        <p className="text-sm text-neutral-500">
          FAQs die der Bot bei Fragen automatisch nutzt · Preistabelle aus Shopify
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen size={14} className="text-neutral-400" />
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">FAQ-Einträge</span>
          </div>
          <div className="text-2xl font-bold text-neutral-900">{faqs?.length ?? 0}</div>
          <div className="text-xs text-neutral-400 mt-0.5">{activeFaqs} aktiv (vom Bot genutzt)</div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={14} className="text-neutral-400" />
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Preis-Einträge</span>
          </div>
          <div className="text-2xl font-bold text-neutral-900">{priceRows.length}</div>
          <div className="text-xs text-neutral-400 mt-0.5">Methoden × Längen × Linien</div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Bot size={14} className="text-neutral-400" />
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Wissens-Architektur</span>
          </div>
          <div className="text-lg font-bold text-neutral-900">Hybrid</div>
          <div className="text-xs text-neutral-400 mt-0.5">FAQs (statisch) + Tools (live)</div>
        </div>
      </div>

      {/* FAQ-Editor */}
      <FaqEditor initialFaqs={faqs ?? []} />

      {/* Price-Table */}
      <PriceTable prices={priceRows} />
    </div>
  );
}
