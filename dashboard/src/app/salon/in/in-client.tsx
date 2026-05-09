"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X, RotateCcw, Minus, Plus } from "lucide-react";
import {
  lookupSalonProduct,
  findOpenEntnahmenByBarcode,
  recordRueckgabeFull,
  recordRueckgabePartial,
  type SalonProductInfo,
} from "@/lib/actions/salon";
import ScanInput from "../scan-input";

type Step =
  | "scan"
  | "preview"
  | "matchPick"
  | "fullOrPartial"
  | "pieces"
  | "done"
  | "error";

interface OpenEntry {
  id: string;
  employeeName: string;
  takenAt: string;
}

export default function InClient() {
  const [step, setStep] = useState<Step>("scan");
  const [product, setProduct] = useState<SalonProductInfo | null>(null);
  const [openEntries, setOpenEntries] = useState<OpenEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<OpenEntry | null>(null);
  const [pieces, setPieces] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setStep("scan");
    setProduct(null);
    setOpenEntries([]);
    setSelectedEntry(null);
    setPieces(0);
    setError(null);
  }

  function onScan(barcode: string) {
    setError(null);
    start(async () => {
      const lookup = await lookupSalonProduct(barcode);
      if (!lookup.ok) {
        setError(lookup.error);
        setStep("error");
        return;
      }
      const matches = await findOpenEntnahmenByBarcode(barcode);
      if (!matches.ok) {
        setError(matches.error);
        setStep("error");
        return;
      }
      if (matches.entries.length === 0) {
        setError("Keine offene Entnahme fuer diesen Pack");
        setStep("error");
        return;
      }
      setProduct(lookup.product);
      setOpenEntries(matches.entries);
      if (matches.entries.length === 1) {
        setSelectedEntry(matches.entries[0]);
        setStep("fullOrPartial");
      } else {
        setStep("matchPick");
      }
    });
  }

  function onFullReturn() {
    if (!selectedEntry) return;
    start(async () => {
      const res = await recordRueckgabeFull(selectedEntry.id);
      if (!res.ok) {
        setError(res.error);
        setStep("error");
        return;
      }
      setStep("done");
    });
  }

  function onConfirmPieces() {
    if (!selectedEntry || !product) return;
    if (pieces <= 0) {
      setError("Stueckzahl muss > 0 sein");
      return;
    }
    start(async () => {
      const res = await recordRueckgabePartial({
        entnahmeId: selectedEntry.id,
        restPieces: pieces,
      });
      if (!res.ok) {
        setError(res.error);
        setStep("error");
        return;
      }
      setStep("done");
    });
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-4 py-3 flex items-center gap-3 border-b border-neutral-900">
        <Link href="/salon" className="p-2 -ml-2 hover:bg-neutral-900 rounded-lg">
          <ArrowLeft size={24} />
        </Link>
        <div className="text-lg font-semibold">Zurueckgeben</div>
      </header>

      {step === "scan" && (
        <div className="flex-1 flex flex-col p-6 max-w-2xl w-full mx-auto justify-center gap-8">
          <div className="text-center">
            <div className="text-3xl font-bold">Pack scannen</div>
            <div className="text-neutral-400 mt-2">Auch wenn vollstaendig zurueck — bitte scannen</div>
          </div>
          <ScanInput onScan={onScan} busy={pending} />
        </div>
      )}

      {step === "matchPick" && product && (
        <div className="flex-1 p-6 max-w-2xl w-full mx-auto space-y-4">
          <ProductCard p={product} />
          <div className="text-center text-lg mt-4">Mehrere offene Entnahmen — wer bist du?</div>
          <div className="grid grid-cols-2 gap-3">
            {openEntries.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  setSelectedEntry(e);
                  setStep("fullOrPartial");
                }}
                className="bg-neutral-800 hover:bg-neutral-700 rounded-2xl py-6 text-xl font-semibold"
              >
                <div>{e.employeeName}</div>
                <div className="text-xs text-neutral-400 mt-1">
                  {new Date(e.takenAt).toLocaleString("de-DE", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "fullOrPartial" && product && selectedEntry && (
        <div className="flex-1 p-6 max-w-2xl w-full mx-auto space-y-4">
          <ProductCard p={product} />
          <div className="text-center text-sm text-neutral-400">Entnommen durch {selectedEntry.employeeName}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <button
              onClick={onFullReturn}
              disabled={pending}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 rounded-2xl py-10 text-2xl font-bold"
            >
              Vollstaendig zurueck
              <div className="text-sm font-normal text-emerald-100 mt-1">Pack ist unangebrochen</div>
            </button>
            <button
              onClick={() => {
                if (!product.divisible) {
                  setError("Diese Kategorie ist nicht anbrechbar");
                  return;
                }
                setStep("pieces");
                setPieces(0);
              }}
              disabled={pending || !product.divisible}
              className="bg-amber-600 hover:bg-amber-500 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-2xl py-10 text-2xl font-bold"
            >
              Angebrochen
              <div className="text-sm font-normal text-amber-100 mt-1">
                {product.divisible ? `${product.gramsPerPiece}g pro Stueck` : "nicht teilbar"}
              </div>
            </button>
          </div>
          {error && <div className="text-rose-400 text-center">{error}</div>}
        </div>
      )}

      {step === "pieces" && product && (
        <div className="flex-1 p-6 max-w-md w-full mx-auto space-y-6 flex flex-col justify-center">
          <ProductCard p={product} />
          <div className="text-center">
            <div className="text-xl font-semibold">Wie viele Stueck sind noch im Pack?</div>
            <div className="text-sm text-neutral-400 mt-1">
              {product.gramsPerPiece}g pro Stueck — Pack hatte {product.packGrams}g
            </div>
          </div>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setPieces((p) => Math.max(0, p - 1))}
              className="w-20 h-20 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center"
            >
              <Minus size={32} />
            </button>
            <div className="text-center min-w-[120px]">
              <div className="text-7xl font-bold tabular-nums">{pieces}</div>
              <div className="text-neutral-400 text-sm mt-1">
                = {product.gramsPerPiece ? Math.round((product.gramsPerPiece * pieces) * 10) / 10 : 0}g Rest
              </div>
            </div>
            <button
              onClick={() => setPieces((p) => p + 1)}
              className="w-20 h-20 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center"
            >
              <Plus size={32} />
            </button>
          </div>
          <button
            onClick={onConfirmPieces}
            disabled={pending || pieces <= 0}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 rounded-2xl py-6 text-xl font-bold"
          >
            Bestaetigen
          </button>
          {error && <div className="text-rose-400 text-center">{error}</div>}
        </div>
      )}

      {step === "done" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          <div className="bg-emerald-600 rounded-full p-6">
            <Check size={80} />
          </div>
          <div className="text-3xl font-bold">Zurueckgegeben</div>
          <div className="grid grid-cols-2 gap-3 w-full max-w-md mt-4">
            <Link href="/salon" className="bg-neutral-800 hover:bg-neutral-700 rounded-xl py-4 text-center font-semibold">
              Zurueck
            </Link>
            <button onClick={reset} className="bg-emerald-600 hover:bg-emerald-500 rounded-xl py-4 font-semibold flex items-center justify-center gap-2">
              <RotateCcw size={18} /> Naechste
            </button>
          </div>
        </div>
      )}

      {step === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          <div className="bg-rose-600 rounded-full p-6">
            <X size={80} />
          </div>
          <div className="text-3xl font-bold">Fehler</div>
          <div className="text-center text-neutral-300 max-w-md">{error}</div>
          <button onClick={reset} className="bg-rose-600 hover:bg-rose-500 rounded-xl px-8 py-4 font-semibold">
            Nochmal
          </button>
        </div>
      )}
    </div>
  );
}

function ProductCard({ p }: { p: SalonProductInfo }) {
  return (
    <div className="bg-neutral-900 rounded-2xl p-4 flex gap-4 items-center">
      {p.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt="" className="w-20 h-20 rounded-xl object-cover bg-neutral-800" />
      ) : (
        <div className="w-20 h-20 rounded-xl bg-neutral-800" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold leading-tight">{p.productTitle}</div>
        {p.variantTitle && <div className="text-neutral-400 text-sm">{p.variantTitle}</div>}
        <div className="mt-1 flex gap-2 text-xs">
          <span className="px-2 py-0.5 bg-neutral-800 rounded">{p.categoryLabel}</span>
          <span className="px-2 py-0.5 bg-neutral-800 rounded">{p.packGrams}g</span>
        </div>
      </div>
    </div>
  );
}
