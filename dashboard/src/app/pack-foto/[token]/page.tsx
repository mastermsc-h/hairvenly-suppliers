import type { Metadata } from "next";
import type { ReactNode } from "react";
import { verifyHandoffToken } from "@/lib/pack-handoff-token";
import { createServiceClient } from "@/lib/supabase/server";
import HandoffPhotoClient from "./handoff-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Beweisfoto",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Beweisfoto" },
};

/**
 * Öffentliche Handy-Seite für den Foto-Handoff (kein Login). Zugriff nur mit
 * gültigem, signiertem Token (2h, genau eine Session). Zeigt bewusst nur die
 * Bestellnummer — keine Kundendaten, keine Positionen.
 */
export default async function HandoffPhotoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claims = verifyHandoffToken(token);

  if (!claims) {
    return (
      <Shell>
        <div className="text-5xl mb-3">⏱️</div>
        <h1 className="text-xl font-bold text-neutral-900">Link ungültig oder abgelaufen</h1>
        <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
          Der Foto-Link gilt 2 Stunden. Am iMac die Bestellung neu laden — dann erscheint ein
          frischer QR-Code.
        </p>
      </Shell>
    );
  }

  const admin = createServiceClient();
  const [{ data: session }, { count }] = await Promise.all([
    admin.from("pack_sessions").select("order_name, status").eq("id", claims.sessionId).maybeSingle(),
    admin.from("pack_photos").select("id", { count: "exact", head: true }).eq("session_id", claims.sessionId),
  ]);

  if (!session) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-neutral-900">Bestellung nicht gefunden</h1>
      </Shell>
    );
  }
  if (session.status === "shipped") {
    return (
      <Shell>
        <div className="text-5xl mb-3">✅</div>
        <h1 className="text-xl font-bold text-neutral-900">{session.order_name} ist schon versendet</h1>
        <p className="text-sm text-neutral-600 mt-2">Hier gibt es nichts mehr zu fotografieren.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <HandoffPhotoClient token={token} orderName={session.order_name} initialCount={count ?? 0} />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-neutral-50 flex items-start justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 text-center mt-6">
        {children}
      </div>
    </main>
  );
}
