"use client";

import { useTransition } from "react";
import { Pencil } from "lucide-react";
import { reopenPackSession } from "@/lib/actions/pack";

export default function ReopenButton({
  orderName,
  numberClean,
}: {
  orderName: string;
  numberClean: string;
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Bestellung ${orderName} erneut bearbeiten?\n\n` +
          "Sie wird zurück in den Pack-Modus geholt (Scans + Fotos bleiben erhalten). " +
          "Du kannst dann z.B. das Beweisfoto neu machen.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await reopenPackSession(numberClean);
      if (res.success) {
        window.location.href = `/pack/${numberClean}`;
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
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition disabled:opacity-50"
    >
      <Pencil size={15} />
      {pending ? "Wird geöffnet…" : "Erneut bearbeiten"}
    </button>
  );
}
