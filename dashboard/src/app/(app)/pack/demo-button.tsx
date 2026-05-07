"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Beaker } from "lucide-react";
import { createDemoSession } from "@/lib/actions/pack";

export default function DemoButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await createDemoSession();
      if (res.success && res.orderName) {
        const clean = res.orderName.replace(/^#/, "");
        router.push(`/pack/${clean}`);
      } else {
        alert(`Fehler: ${res.error ?? "unbekannt"}`);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-100 border border-purple-300 text-purple-900 text-sm font-medium hover:bg-purple-200 transition disabled:opacity-50"
      title="Demo-Bestellung anlegen zum Testen ohne echte Shopify-Order"
    >
      <Beaker size={14} />
      {pending ? "Demo wird angelegt…" : "Demo erstellen"}
    </button>
  );
}
