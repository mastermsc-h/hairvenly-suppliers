import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";

// Pro Request einmal zählen — Badge steht am Menüpunkt UND am Gruppenkopf.
const countInStock = cache(async (): Promise<number> => {
  const { count } = await createServiceClient()
    .from("chat_reservations")
    .select("id", { count: "exact", head: true })
    .eq("status", "waiting")
    .eq("last_stock_status", "in_stock");
  return count ?? 0;
});

/**
 * Sidebar-Badge: wartende Reservierungen, deren Ware laut letztem Lager-Check
 * (täglicher Cron /api/cron/reservations-check) wieder vorrätig ist.
 * `compact`: Variante für den eingeklappten Chatbot-Gruppenkopf.
 */
export default async function ReservationsInStockBadge({ compact = false }: { compact?: boolean }) {
  const n = await countInStock().catch(() => 0);
  if (n === 0) return null;
  const title = `${n} wartende Reservierung${n === 1 ? " ist" : "en sind"} wieder auf Lager — Kundinnen benachrichtigen`;
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-green-600 text-white text-[10px] font-semibold ${compact ? "ml-auto" : ""}`}
      title={title}
    >
      {n}
    </span>
  );
}
