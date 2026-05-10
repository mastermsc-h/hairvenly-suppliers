"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X, RotateCcw, ListChecks } from "lucide-react";
import {
  lookupSalonProduct,
  listSalonPickableProducts,
  recordEntnahme,
  type SalonProductInfo,
} from "@/lib/actions/salon";
import ScanInput from "../scan-input";
import ProductPicker from "../product-picker";

type Step = "scan" | "preview" | "employee" | "pin" | "done" | "error";

interface PickableProduct extends SalonProductInfo {
  hasBarcode: boolean;
}

interface Employee {
  id: string;
  name: string;
  color: string | null;
}

const TILE_COLORS = [
  "bg-rose-700",
  "bg-amber-700",
  "bg-emerald-700",
  "bg-sky-700",
  "bg-violet-700",
  "bg-fuchsia-700",
  "bg-teal-700",
  "bg-orange-700",
];

export default function OutClient({ employees }: { employees: Employee[] }) {
  const [step, setStep] = useState<Step>("scan");
  const [product, setProduct] = useState<SalonProductInfo | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerProducts, setPickerProducts] = useState<PickableProduct[]>([]);

  function reset() {
    setStep("scan");
    setProduct(null);
    setEmployee(null);
    setPin("");
    setError(null);
  }

  function onScan(barcode: string) {
    setError(null);
    start(async () => {
      const res = await lookupSalonProduct(barcode);
      if (!res.ok) {
        setError(res.error);
        setStep("error");
        return;
      }
      setProduct(res.product);
      setStep("preview");
    });
  }

  async function openPicker() {
    setError(null);
    if (pickerProducts.length > 0) {
      setPickerOpen(true);
      return;
    }
    setPickerLoading(true);
    const res = await listSalonPickableProducts();
    setPickerLoading(false);
    if (!res.ok) {
      setError(res.error);
      setStep("error");
      return;
    }
    setPickerProducts(res.products);
    setPickerOpen(true);
  }

  function onPickerPick(p: PickableProduct) {
    setPickerOpen(false);
    setProduct(p);
    setStep("preview");
  }

  function onPinDigit(d: string) {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    if (next.length >= 4 && employee && product) {
      start(async () => {
        const res = await recordEntnahme({
          barcode: product.barcode || null,
          variantId: product.variantId,
          pin: next,
        });
        if (!res.ok) {
          setError(res.error);
          setStep("error");
          setPin("");
          return;
        }
        setStep("done");
      });
    }
  }
  function onPinDel() {
    setPin((p) => p.slice(0, -1));
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header onBack={reset} />

      {step === "scan" && (
        <div className="flex-1 flex flex-col p-6 max-w-2xl w-full mx-auto justify-center gap-8">
          <div className="text-center">
            <div className="text-3xl font-bold">Pack scannen</div>
            <div className="text-neutral-400 mt-2">Barcode ans Lesegeraet halten oder Kamera nutzen</div>
          </div>
          <ScanInput onScan={onScan} busy={pending} />
          <div className="text-center">
            <button
              onClick={openPicker}
              disabled={pickerLoading}
              className="inline-flex items-center gap-2 text-base text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-500 rounded-xl px-5 py-3 disabled:opacity-50"
            >
              <ListChecks size={18} />
              {pickerLoading ? "Lade..." : "Kein Barcode? Manuell auswählen"}
            </button>
          </div>
        </div>
      )}

      {pickerOpen && (
        <ProductPicker
          products={pickerProducts}
          onPick={onPickerPick}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {step === "preview" && product && (
        <div className="flex-1 flex flex-col p-6 max-w-2xl w-full mx-auto gap-6">
          <ProductCard p={product} />
          <button
            onClick={() => setStep("employee")}
            className="bg-rose-600 hover:bg-rose-500 rounded-2xl py-6 text-2xl font-bold"
          >
            Weiter — Mitarbeiter waehlen
          </button>
          <button onClick={reset} className="text-neutral-400 hover:text-white">
            Anderen Pack scannen
          </button>
        </div>
      )}

      {step === "employee" && (
        <div className="flex-1 flex flex-col p-6 gap-4">
          <div className="text-2xl font-bold text-center">Wer entnimmt?</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-3xl w-full mx-auto">
            {employees.length === 0 && (
              <div className="col-span-full text-center text-rose-400">
                Keine Mitarbeiter angelegt. Bitte im Manager-Dashboard hinzufuegen.
              </div>
            )}
            {employees.map((e, i) => (
              <button
                key={e.id}
                onClick={() => {
                  setEmployee(e);
                  setStep("pin");
                }}
                className={`${e.color ?? TILE_COLORS[i % TILE_COLORS.length]} rounded-2xl py-10 text-2xl font-bold hover:opacity-90 active:scale-95 transition`}
              >
                {e.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "pin" && employee && (
        <div className="flex-1 flex flex-col p-6 gap-6 max-w-md w-full mx-auto">
          <div className="text-center">
            <div className="text-xl text-neutral-400">{employee.name}</div>
            <div className="text-2xl font-bold mt-1">PIN eingeben</div>
            <div className="mt-4 flex gap-3 justify-center">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-5 h-5 rounded-full border-2 ${i < pin.length ? "bg-white border-white" : "border-neutral-600"}`}
                />
              ))}
            </div>
          </div>
          <Numpad onDigit={onPinDigit} onDel={onPinDel} disabled={pending} />
          {pending && <div className="text-center text-neutral-400">Speichere...</div>}
        </div>
      )}

      {step === "done" && product && employee && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          <div className="bg-emerald-600 rounded-full p-6">
            <Check size={80} />
          </div>
          <div className="text-3xl font-bold">Entnommen</div>
          <div className="text-center text-neutral-300">
            <div className="text-xl">{product.productTitle}</div>
            {product.variantTitle && <div>{product.variantTitle}</div>}
            <div className="mt-2 text-neutral-400">durch {employee.name}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 w-full max-w-md mt-4">
            <Link href="/salon" className="bg-neutral-800 hover:bg-neutral-700 rounded-xl py-4 text-center font-semibold">
              Zurueck
            </Link>
            <button onClick={reset} className="bg-rose-600 hover:bg-rose-500 rounded-xl py-4 font-semibold flex items-center justify-center gap-2">
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
            Nochmal versuchen
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <header className="px-4 py-3 flex items-center gap-3 border-b border-neutral-900">
      <Link href="/salon" className="p-2 -ml-2 hover:bg-neutral-900 rounded-lg" onClick={onBack}>
        <ArrowLeft size={24} />
      </Link>
      <div className="text-lg font-semibold">Entnehmen</div>
    </header>
  );
}

function ProductCard({ p }: { p: SalonProductInfo }) {
  return (
    <div className="bg-neutral-900 rounded-2xl p-4 flex gap-4 items-center">
      {p.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt="" className="w-24 h-24 rounded-xl object-cover bg-neutral-800" />
      ) : (
        <div className="w-24 h-24 rounded-xl bg-neutral-800" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold leading-tight">{p.productTitle}</div>
        {p.variantTitle && <div className="text-neutral-400 text-sm mt-0.5">{p.variantTitle}</div>}
        <div className="mt-2 flex gap-2 text-xs">
          <span className="px-2 py-0.5 bg-neutral-800 rounded">{p.categoryLabel}</span>
          <span className="px-2 py-0.5 bg-neutral-800 rounded">{p.packGrams}g</span>
        </div>
      </div>
    </div>
  );
}

function Numpad({
  onDigit,
  onDel,
  disabled,
}: {
  onDigit: (d: string) => void;
  onDel: () => void;
  disabled?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div className="grid grid-cols-3 gap-3">
      {keys.map((k, i) => {
        if (k === "") return <div key={i} />;
        if (k === "del")
          return (
            <button
              key={i}
              onClick={onDel}
              disabled={disabled}
              className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 rounded-2xl py-6 text-xl font-semibold"
            >
              ⌫
            </button>
          );
        return (
          <button
            key={i}
            onClick={() => onDigit(k)}
            disabled={disabled}
            className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 rounded-2xl py-6 text-3xl font-bold active:scale-95 transition"
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}
