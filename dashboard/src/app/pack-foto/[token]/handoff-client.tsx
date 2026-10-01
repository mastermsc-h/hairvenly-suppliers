"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { uploadPackPhotoByToken } from "@/lib/actions/pack-handoff";
import { resizeImage } from "@/lib/image-resize";

/**
 * Ein Knopf, ein Foto. Nach dem Upload: klare Bestätigung, dass der iMac
 * automatisch weitermacht — das Handy kann weggelegt werden.
 */
export default function HandoffPhotoClient({
  token,
  orderName,
  initialCount,
}: {
  token: string;
  orderName: string;
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);
  const [justUploaded, setJustUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(file: File) {
    setError(null);
    startTransition(async () => {
      try {
        const compressed = await resizeImage(file, 2000, 1500, 0.85);
        const fd = new FormData();
        fd.append("photo", compressed);
        const res = await uploadPackPhotoByToken(token, fd);
        if (res.success) {
          setCount(res.count ?? count + 1);
          setJustUploaded(true);
        } else {
          setError(res.error ?? "Upload fehlgeschlagen");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload fehlgeschlagen");
      }
    });
  }

  return (
    <div>
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Beweisfoto</div>
      <h1 className="text-2xl font-bold text-neutral-900 mt-1">{orderName}</h1>
      <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
        Produkte <strong>mit der Rechnung</strong> fotografieren.
      </p>

      {justUploaded ? (
        <div className="mt-5 bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-5">
          <CheckCircle2 className="mx-auto text-emerald-600" size={56} strokeWidth={2.5} />
          <div className="text-lg font-bold text-emerald-900 mt-2">Foto übernommen</div>
          <div className="text-sm text-emerald-800 mt-1 leading-relaxed">
            Der iMac macht automatisch weiter — du kannst das Handy weglegen.
          </div>
          <div className="text-xs text-emerald-700 mt-2">{count} Foto{count === 1 ? "" : "s"} gespeichert</div>
        </div>
      ) : (
        count > 0 && (
          <div className="mt-3 text-xs text-neutral-500">{count} Foto{count === 1 ? "" : "s"} bereits vorhanden</div>
        )
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className={`mt-5 w-full py-5 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition disabled:opacity-60 ${
          justUploaded ? "bg-white border-2 border-neutral-300 text-neutral-800" : "bg-blue-600 text-white active:scale-[0.98]"
        }`}
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" size={22} /> Lädt hoch…
          </>
        ) : (
          <>
            <Camera size={22} /> {justUploaded ? "Weiteres Foto" : "Foto aufnehmen"}
          </>
        )}
      </button>

      {error && (
        <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>
      )}

      <p className="text-[11px] text-neutral-400 mt-5 leading-relaxed">
        Kein Login nötig — dieser Link gilt 2 Stunden und nur für diese Bestellung.
      </p>
    </div>
  );
}
