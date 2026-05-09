import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { isSalonDevicePaired } from "@/lib/salon/auth";
import PairForm from "./pair-form";

export const dynamic = "force-dynamic";

export default async function SalonHomePage() {
  const paired = await isSalonDevicePaired();
  if (!paired) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <PairForm />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 pt-6 pb-2 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-neutral-500">Hairvenly Salon</div>
          <div className="text-2xl font-semibold">Lager</div>
        </div>
        <div className="text-xs text-neutral-500">
          {new Date().toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" })}
        </div>
      </header>

      <main className="flex-1 grid grid-cols-2 gap-4 p-4">
        <Link
          href="/salon/out"
          className="rounded-3xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 transition flex flex-col items-center justify-center gap-6 shadow-2xl"
        >
          <ArrowUpFromLine size={120} strokeWidth={1.5} />
          <div className="text-5xl font-bold tracking-tight">Entnehmen</div>
          <div className="text-base text-rose-100">Pack aus dem Lager</div>
        </Link>

        <Link
          href="/salon/in"
          className="rounded-3xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 transition flex flex-col items-center justify-center gap-6 shadow-2xl"
        >
          <ArrowDownToLine size={120} strokeWidth={1.5} />
          <div className="text-5xl font-bold tracking-tight">Zurueckgeben</div>
          <div className="text-base text-emerald-100">Pack oder Reste</div>
        </Link>
      </main>

      <footer className="px-6 py-3 text-xs text-neutral-600 text-center">
        Stand: {new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
      </footer>
    </div>
  );
}
