"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { t, type Locale } from "@/lib/i18n";
import { CheckCircle2, ScanLine, Send, Package2, Camera } from "lucide-react";

interface ExpectedItem {
  barcode: string | null;
  title: string;
  variantTitle: string | null;
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

function detectAttributes(title: string): {
  method: { label: string; cls: string };
  length: string;
  origin: string;
  color: string;
} {
  const upper = title.toUpperCase();
  let method = { label: "", cls: "" };
  if (upper.includes("BONDING")) method = { label: "BONDINGS", cls: "bg-orange-600" };
  else if (upper.includes("MINI TAPE") || upper.includes("MINI-TAPE"))
    method = { label: "MINI-TAPES", cls: "bg-blue-600" };
  else if (upper.includes("TAPE")) method = { label: "TAPES", cls: "bg-blue-600" };
  else if (upper.includes("TRESSE")) method = { label: "TRESSEN", cls: "bg-green-600" };
  else if (upper.includes("CLIP")) method = { label: "CLIP-IN", cls: "bg-violet-500" };
  else if (upper.includes("PONYTAIL")) method = { label: "PONYTAIL", cls: "bg-pink-600" };

  let length = "";
  for (const cm of [45, 55, 65, 75, 85]) {
    if (upper.includes(`${cm}CM`)) {
      length = `${cm}cm`;
      break;
    }
  }
  let origin = "";
  if (upper.includes("RU GLATT") || upper.includes("RUSSISCH")) origin = "RU";
  else if (upper.includes("US WELLIG") || upper.includes("USBEKISCH")) origin = "US";

  let color = "";
  const colorMatch = title.match(/#([A-Z0-9/]+(?:T[A-Z0-9]+)?)/i);
  if (colorMatch) color = "#" + colorMatch[1];

  return { method, length, origin, color };
}

const PHOTO_TYPES = ["products_invoice", "products_in_box", "package_on_scale"] as const;
const PHOTO_LABELS: Record<string, string> = {
  products_invoice: "1. Produkte + Rechnung",
  products_in_box: "2. Im Versandkarton",
  package_on_scale: "3. Auf der Waage",
};

export default function PackDisplay({
  initialSession,
  initialCounts,
  initialPhotoCounts,
  locale,
}: {
  initialSession: DisplaySession | null;
  initialCounts: Record<string, number>;
  initialPhotoCounts: Record<string, number>;
  locale: Locale;
}) {
  const [session, setSession] = useState<DisplaySession | null>(initialSession);
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>(initialPhotoCounts);
  const [flash, setFlash] = useState<"match" | "mismatch" | null>(null);
  const [bigSuccessTitle, setBigSuccessTitle] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Auto-Scroll + Hervorhebung beim Highlight
  useEffect(() => {
    if (!highlightKey) return;
    const el = itemRefs.current[highlightKey];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const tm = setTimeout(() => setHighlightKey(null), 1500);
    return () => clearTimeout(tm);
  }, [highlightKey]);

  // Big success auto-clear
  useEffect(() => {
    if (!bigSuccessTitle) return;
    const tm = setTimeout(() => setBigSuccessTitle(null), 700);
    return () => clearTimeout(tm);
  }, [bigSuccessTitle]);

  // Polling-Fallback: alle 3 Sek aktive Session + Counts neu laden.
  // Realtime ist tricky mit RLS, Polling garantiert Updates innerhalb 3s.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    const sessionIdRef = { current: session?.id };

    async function refresh() {
      const { data: rows } = await supabase
        .from("pack_sessions")
        .select(
          "id, order_name, status, expected_items, started_at, finished_at, packed_by, profiles:packed_by(display_name, username)",
        )
        .in("status", ["in_progress", "verified"])
        .order("updated_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const row = rows?.[0];
      if (!row) {
        setSession(null);
        setCounts({});
        sessionIdRef.current = undefined;
        return;
      }
      const profileRel = (row as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
      const next: DisplaySession = {
        id: row.id,
        orderName: row.order_name,
        status: row.status,
        expectedItems: (row.expected_items as ExpectedItem[]) ?? [],
        packedBy: profileRel?.display_name || profileRel?.username || null,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      };
      setSession((prev) =>
        prev && prev.id === next.id && prev.status === next.status ? prev : next,
      );
      // Scan-counts + Foto-counts neu laden
      sessionIdRef.current = row.id;
      const [{ data: scans }, { data: photos }] = await Promise.all([
        supabase
          .from("pack_scans")
          .select("scanned_barcode")
          .eq("session_id", row.id)
          .eq("status", "match"),
        supabase.from("pack_photos").select("photo_type").eq("session_id", row.id),
      ]);
      if (cancelled) return;
      const c: Record<string, number> = {};
      for (const s of scans ?? []) c[s.scanned_barcode] = (c[s.scanned_barcode] ?? 0) + 1;
      setCounts((prev) => {
        const same =
          Object.keys(prev).length === Object.keys(c).length &&
          Object.keys(prev).every((k) => prev[k] === c[k]);
        return same ? prev : c;
      });
      const pc: Record<string, number> = {
        products_invoice: 0,
        products_in_box: 0,
        package_on_scale: 0,
      };
      for (const p of photos ?? []) pc[p.photo_type] = (pc[p.photo_type] ?? 0) + 1;
      setPhotoCounts((prev) => {
        const same = PHOTO_TYPES.every((t) => prev[t] === pc[t]);
        return same ? prev : pc;
      });
    }

    void refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session?.id]);

  const isComplete = useMemo(() => {
    if (!session) return false;
    return session.expectedItems.every((e, idx) => {
      const key = e.barcode || `manual:${idx}`;
      return (counts[key] ?? 0) >= e.quantity;
    });
  }, [session, counts]);

  const photosDone = useMemo(() => {
    return PHOTO_TYPES.every((p) => (photoCounts[p] ?? 0) > 0);
  }, [photoCounts]);

  const reallyReady = isComplete && photosDone;
  const missingPhotoTypes = PHOTO_TYPES.filter((p) => (photoCounts[p] ?? 0) === 0);

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
        async (payload) => {
          const row = payload.new as {
            session_id: string;
            scanned_barcode: string;
            status: string;
            matched_title: string | null;
          };
          // Falls Scan zu einer anderen Session als der aktuell angezeigten gehört:
          // Session-Refetch (Display switcht zur neuesten aktiven Session).
          if (!session || row.session_id !== session.id) {
            const { data: rows } = await supabase
              .from("pack_sessions")
              .select(
                "id, order_name, status, expected_items, started_at, finished_at, packed_by, profiles:packed_by(display_name, username)",
              )
              .in("status", ["in_progress", "verified"])
              .order("updated_at", { ascending: false })
              .limit(1);
            const newSession = rows?.[0];
            if (newSession) {
              const profileRel = (newSession as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
              setSession({
                id: newSession.id,
                orderName: newSession.order_name,
                status: newSession.status,
                expectedItems: (newSession.expected_items as ExpectedItem[]) ?? [],
                packedBy: profileRel?.display_name || profileRel?.username || null,
                startedAt: newSession.started_at,
                finishedAt: newSession.finished_at,
              });
              const { data: scans } = await supabase
                .from("pack_scans")
                .select("scanned_barcode")
                .eq("session_id", newSession.id)
                .eq("status", "match");
              const c: Record<string, number> = {};
              for (const s of scans ?? []) c[s.scanned_barcode] = (c[s.scanned_barcode] ?? 0) + 1;
              setCounts(c);
            }
            // Trotzdem Flash zeigen damit das Live-Feedback klar ist
            if (row.status === "match") {
              setFlash("match");
              setBigSuccessTitle(row.matched_title || "OK");
              setHighlightKey(row.scanned_barcode);
            } else if (row.status === "mismatch" || row.status === "overflow") {
              setFlash("mismatch");
            }
            setTimeout(() => setFlash(null), row.status === "match" ? 600 : 1500);
            return;
          }

          // Scan zur aktuell angezeigten Session
          if (row.status === "match") {
            setCounts((prev) => ({ ...prev, [row.scanned_barcode]: (prev[row.scanned_barcode] ?? 0) + 1 }));
            setFlash("match");
            setBigSuccessTitle(row.matched_title || "OK");
            setHighlightKey(row.scanned_barcode);
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
      {bigSuccessTitle && (
        <div className="fixed inset-0 z-50 bg-emerald-500/90 flex items-center justify-center pointer-events-none">
          <div className="text-center text-white px-12">
            <CheckCircle2 size={220} className="mx-auto" strokeWidth={2.5} />
            <div className="text-7xl font-black mt-6">{bigSuccessTitle}</div>
          </div>
        </div>
      )}

      <div className="p-8 md:p-12">
        <div className="flex items-baseline justify-between mb-6">
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

        {/* 3-Schritte Progress (kompakt — Fokus bleibt auf Produkten) */}
        {session.status !== "shipped" && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {([
              { key: "scan", label: "1. Scannen", icon: ScanLine, done: isComplete, active: !isComplete },
              { key: "photos", label: "2. Fotos", icon: Camera, done: photosDone, active: isComplete && !photosDone },
              { key: "ship", label: "3. Versenden", icon: Send, done: false, active: reallyReady },
            ] as const).map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold ${
                    step.done
                      ? "bg-emerald-700 text-white"
                      : step.active
                      ? "bg-blue-600 text-white ring-2 ring-blue-400/40"
                      : "bg-neutral-800 text-neutral-500"
                  }`}
                >
                  {step.done ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                  {step.label}
                </div>
              );
            })}
          </div>
        )}

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
                const counterKey = it.barcode || `manual:${idx}`;
                const got = counts[counterKey] ?? 0;
                const done = got >= it.quantity;
                const a = detectAttributes(it.title);
                const isHighlighted = highlightKey === counterKey;
                return (
                  <div
                    key={idx}
                    ref={(el) => {
                      itemRefs.current[counterKey] = el;
                    }}
                    className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-all duration-300 scroll-mt-32 ${
                      isHighlighted
                        ? "border-emerald-300 bg-emerald-700/40 ring-4 ring-emerald-300/50 scale-[1.02]"
                        : done
                        ? "border-emerald-500 bg-emerald-900/30"
                        : "border-neutral-700 bg-neutral-900"
                    }`}
                  >
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imageUrl} alt="" className="w-28 h-28 rounded-lg object-cover bg-white shrink-0" />
                    ) : (
                      <div className="w-28 h-28 rounded-lg bg-neutral-800 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap gap-2 mb-2">
                        {a.method.label && (
                          <span className={`inline-block ${a.method.cls} text-white text-lg font-bold px-3 py-1 rounded tracking-widest`}>
                            {a.method.label}
                          </span>
                        )}
                        {a.length && (
                          <span className="inline-block bg-slate-600 text-white text-lg font-bold px-3 py-1 rounded tracking-wider">
                            {a.length}
                          </span>
                        )}
                        {a.origin && (
                          <span className="inline-block bg-slate-800 text-white text-lg font-bold px-3 py-1 rounded tracking-wider">
                            {a.origin}
                          </span>
                        )}
                        {a.color && (
                          <span className="inline-block bg-amber-500 text-white text-lg font-bold px-3 py-1 rounded font-mono">
                            {a.color}
                          </span>
                        )}
                      </div>
                      <div className="text-base text-neutral-300 mt-1 line-clamp-2">{it.title}</div>
                      {it.variantTitle && it.variantTitle !== "Default Title" && (
                        <div className="text-base font-bold text-emerald-300 mt-1">
                          Variante: {it.variantTitle}
                        </div>
                      )}
                    </div>
                    <div className={`text-5xl font-black shrink-0 ${done ? "text-emerald-400" : "text-neutral-500"}`}>
                      {got}/{it.quantity}
                    </div>
                    {done && <CheckCircle2 className="text-emerald-400 shrink-0" size={48} />}
                  </div>
                );
              })}
            </div>

            {isComplete && session.status !== "shipped" && (
              <div
                className={`mt-8 p-6 rounded-2xl text-center ${
                  reallyReady
                    ? "bg-emerald-700"
                    : "bg-amber-600"
                }`}
              >
                {reallyReady ? (
                  <>
                    <CheckCircle2 className="mx-auto mb-3 text-white" size={64} />
                    <div className="text-4xl font-black text-white">{t(locale, "shipping.ready")}</div>
                  </>
                ) : (
                  <>
                    <Camera className="mx-auto mb-3 text-white" size={56} />
                    <div className="text-3xl font-black text-white mb-3">
                      Noch {missingPhotoTypes.length} Foto{missingPhotoTypes.length === 1 ? "" : "s"} machen
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-4 text-sm">
                      {PHOTO_TYPES.map((t) => {
                        const got = (photoCounts[t] ?? 0) > 0;
                        return (
                          <div
                            key={t}
                            className={`px-3 py-2 rounded-lg flex items-center gap-2 justify-center font-semibold ${
                              got
                                ? "bg-white/95 text-emerald-700"
                                : "bg-black/25 text-white/90 border border-white/20"
                            }`}
                          >
                            {got ? <CheckCircle2 size={16} /> : <Camera size={16} />}
                            <span>{PHOTO_LABELS[t]}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
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
