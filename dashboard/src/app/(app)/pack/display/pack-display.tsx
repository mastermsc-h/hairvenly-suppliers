"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { t, type Locale } from "@/lib/i18n";
import { CheckCircle2, ScanLine, Send, Package2 } from "lucide-react";

interface ExpectedItem {
  barcode: string | null;
  title: string;
  quantity: number;
  imageUrl: string | null;
}

interface DisplaySession {
  id: string;
  orderName: string;
  status: string;
  expectedItems: ExpectedItem[];
  packedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

function detectMethod(title: string): { label: string; cls: string } {
  const upper = title.toUpperCase();
  if (upper.includes("BONDING")) return { label: "BONDINGS", cls: "bg-orange-600" };
  if (upper.includes("MINI TAPE") || upper.includes("MINI-TAPE"))
    return { label: "MINI-TAPES", cls: "bg-blue-600" };
  if (upper.includes("TAPE")) return { label: "TAPES", cls: "bg-blue-600" };
  if (upper.includes("TRESSE")) return { label: "TRESSEN", cls: "bg-green-600" };
  if (upper.includes("CLIP")) return { label: "CLIP-IN", cls: "bg-violet-500" };
  if (upper.includes("PONYTAIL")) return { label: "PONYTAIL", cls: "bg-pink-600" };
  return { label: "", cls: "" };
}

export default function PackDisplay({
  initialSession,
  initialCounts,
  locale,
}: {
  initialSession: DisplaySession | null;
  initialCounts: Record<string, number>;
  locale: Locale;
}) {
  const [session, setSession] = useState<DisplaySession | null>(initialSession);
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts);
  const [flash, setFlash] = useState<"match" | "mismatch" | null>(null);

  const isComplete = useMemo(() => {
    if (!session) return false;
    return session.expectedItems.every((e) => (counts[e.barcode ?? ""] ?? 0) >= e.quantity);
  }, [session, counts]);

  // Realtime: pack_sessions + pack_scans
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("pack-display")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pack_sessions" },
        async () => {
          // Refetch active session: in_progress oder gerade verified
          const { data: rows } = await supabase
            .from("pack_sessions")
            .select(
              "id, order_name, status, expected_items, started_at, finished_at, packed_by, profiles:packed_by(display_name, username)",
            )
            .in("status", ["in_progress", "verified"])
            .order("updated_at", { ascending: false })
            .limit(1);
          const newSession = rows?.[0];
          if (!newSession) {
            setSession(null);
            setCounts({});
            return;
          }
          const profileRel = (newSession as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
          const packedBy = profileRel?.display_name || profileRel?.username || null;
          setSession({
            id: newSession.id,
            orderName: newSession.order_name,
            status: newSession.status,
            expectedItems: (newSession.expected_items as ExpectedItem[]) ?? [],
            packedBy,
            startedAt: newSession.started_at,
            finishedAt: newSession.finished_at,
          });
          // Counts neu laden
          const { data: scans } = await supabase
            .from("pack_scans")
            .select("scanned_barcode")
            .eq("session_id", newSession.id)
            .eq("status", "match");
          const c: Record<string, number> = {};
          for (const s of scans ?? []) {
            c[s.scanned_barcode] = (c[s.scanned_barcode] ?? 0) + 1;
          }
          setCounts(c);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pack_scans" },
        (payload) => {
          const row = payload.new as { session_id: string; scanned_barcode: string; status: string };
          if (!session || row.session_id !== session.id) return;
          if (row.status === "match") {
            setCounts((prev) => ({ ...prev, [row.scanned_barcode]: (prev[row.scanned_barcode] ?? 0) + 1 }));
            setFlash("match");
            setTimeout(() => setFlash(null), 600);
          } else if (row.status === "mismatch" || row.status === "overflow") {
            setFlash("mismatch");
            setTimeout(() => setFlash(null), 1500);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  // Wartebildschirm
  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center p-8">
        <Package2 size={120} className="text-neutral-700 mb-6" />
        <div className="text-5xl font-bold mb-3">{t(locale, "shipping.display_waiting")}</div>
        <div className="text-xl text-neutral-400 mt-2 max-w-2xl">
          {t(locale, "shipping.display_subtitle")}
        </div>
      </div>
    );
  }

  // Aktive Session
  return (
    <div className="min-h-screen relative">
      {flash === "mismatch" && (
        <div className="fixed inset-0 z-50 bg-red-700/95 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-9xl font-black animate-pulse">STOP</div>
            <div className="text-3xl mt-4">{t(locale, "shipping.scan_mismatch")}</div>
          </div>
        </div>
      )}
      {flash === "match" && (
        <div className="fixed inset-x-0 top-0 h-3 bg-emerald-400 z-50" />
      )}

      <div className="p-8 md:p-12">
        <div className="flex items-baseline justify-between mb-8">
          <div>
            <div className="text-sm uppercase tracking-widest text-neutral-500">{t(locale, "shipping.title")}</div>
            <div className="text-6xl font-black tracking-tight">{session.orderName}</div>
            {session.packedBy && (
              <div className="text-sm text-neutral-400 mt-1">
                {t(locale, "shipping.packed_by")}: {session.packedBy}
              </div>
            )}
          </div>
          <StatusBadge status={session.status} locale={locale} />
        </div>

        {session.status === "shipped" ? (
          <div className="text-center py-20">
            <Send className="mx-auto text-blue-400 mb-6" size={120} />
            <div className="text-6xl font-bold text-blue-300">
              {t(locale, "shipping.fulfill_success")}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {session.expectedItems.map((it, idx) => {
                const got = counts[it.barcode ?? ""] ?? 0;
                const done = got >= it.quantity;
                const m = detectMethod(it.title);
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-4 p-5 rounded-2xl border-2 ${
                      done
                        ? "border-emerald-500 bg-emerald-900/30"
                        : "border-neutral-700 bg-neutral-900"
                    }`}
                  >
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imageUrl} alt="" className="w-24 h-24 rounded-lg object-cover bg-white" />
                    ) : (
                      <div className="w-24 h-24 rounded-lg bg-neutral-800" />
                    )}
                    <div className="flex-1 min-w-0">
                      {m.label && (
                        <span
                          className={`inline-block ${m.cls} text-white text-base font-bold px-3 py-1 rounded mr-2 tracking-widest`}
                        >
                          {m.label}
                        </span>
                      )}
                      <div className="text-xl font-semibold text-white mt-2 line-clamp-2">{it.title}</div>
                    </div>
                    <div className={`text-5xl font-black ${done ? "text-emerald-400" : "text-neutral-500"}`}>
                      {got}/{it.quantity}
                    </div>
                    {done && <CheckCircle2 className="text-emerald-400" size={48} />}
                  </div>
                );
              })}
            </div>

            {isComplete && session.status !== "shipped" && (
              <div className="mt-8 p-8 bg-emerald-700 rounded-2xl text-center">
                <CheckCircle2 className="mx-auto mb-4" size={80} />
                <div className="text-5xl font-black">{t(locale, "shipping.ready")}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    open: {
      label: t(locale, "shipping.status_open"),
      cls: "bg-neutral-800 text-neutral-200",
      icon: <ScanLine size={20} />,
    },
    in_progress: {
      label: t(locale, "shipping.status_in_progress"),
      cls: "bg-amber-600 text-white",
      icon: <ScanLine size={20} />,
    },
    verified: {
      label: t(locale, "shipping.status_verified"),
      cls: "bg-emerald-600 text-white",
      icon: <CheckCircle2 size={20} />,
    },
    shipped: {
      label: t(locale, "shipping.status_shipped"),
      cls: "bg-blue-600 text-white",
      icon: <Send size={20} />,
    },
  };
  const item = map[status] ?? map.open;
  return (
    <div className={`px-4 py-2 rounded-full text-lg font-bold flex items-center gap-2 ${item.cls}`}>
      {item.icon}
      {item.label}
    </div>
  );
}
