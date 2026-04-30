"use client";

import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Trash2, ShoppingCart, Search, Check, X, Copy,
  AlertTriangle, CheckCircle2, Package, FileText, Sparkles, ClipboardList,
  Download, ChevronDown, ChevronRight, ExternalLink,
} from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { createWizardOrder, exportOrderToGoogleSheet, generateAndUploadPDF, importOrderSuggestions, getSuggestionMeta, triggerSuggestionGeneration } from "@/lib/actions/orders";
import type { Supplier, CatalogMethod, ProductColor } from "@/lib/types";

interface Props {
  suppliers: Supplier[];
  catalogs: Record<string, CatalogMethod[]>;
  locale: Locale;
}

interface CartItem {
  id: string;
  colorId: string | null;
  method: string;
  methodName: string;
  length: string;
  color: string;
  quantity: number;
  unit: string;
}

const QUANTITY_PRESETS = [100, 200, 300, 500, 800, 1000, 1500, 2000];
const fmt = (n: number) => new Intl.NumberFormat("de-DE").format(n);

/** Stop-Wörter, die zur Methoden-/Längen-/Variant-Beschreibung gehören
 *  und beim Color-Token-Matching ausgeblendet werden müssen. */
const COLOR_STOP_WORDS = new Set([
  "STANDARD", "RUSSISCH", "RUSSISCHE", "RUSSISCHES", "US", "WELLIGE", "WELLIG",
  "TAPE", "TAPES", "BONDING", "BONDINGS", "MINI", "MINITAPE", "MINITAPES",
  "INVISIBLE", "CLASSIC", "GENIUS", "TRESSEN", "WEFT", "WEFTS",
  "CLIP", "CLIPS", "CLIPIN", "EXTENSIONS", "EXTENSION", "EXT",
  "KERATIN", "GLATT", "PONYTAIL", "ECHTHAAR", "BUTTERFLY",
  "45CM", "55CM", "65CM", "85CM", "100CM",
]);

/** Normalisiert Farb-Strings für Vergleiche: lowercase, ohne #/♡, Hyphen→Space, Whitespace kompakt. */
function normalizeColor(s: string): string {
  return s
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/♡/g, "")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Liefert die Set der Color-Tokens (ohne Stop-Wörter, ohne Pure-Number-Tokens). */
function colorTokens(s: string): Set<string> {
  const tokens = normalizeColor(s).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (const t of tokens) {
    const upper = t.toUpperCase();
    if (COLOR_STOP_WORDS.has(upper)) continue;
    if (/^\d+G?$/i.test(t)) continue;
    out.add(t);
  }
  return out;
}

let _nextId = 1;
const uid = () => `wi-${_nextId++}`;

export default function WizardForm({ suppliers, catalogs, locale }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // State
  const [supplierId, setSupplierId] = useState("");
  const [region, setRegion] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [currentMethod, setCurrentMethod] = useState("");
  const [currentLength, setCurrentLength] = useState("");
  const [currentColor, setCurrentColor] = useState<ProductColor | null>(null);
  const [currentQty, setCurrentQty] = useState("");
  const [colorSearch, setColorSearch] = useState("");
  const [items, setItems] = useState<CartItem[]>([]);
  const [showChecker, setShowChecker] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [importing, startImport] = useTransition();
  const [importStats, setImportStats] = useState<{ total: number; matched: number; unmatched: string[] } | null>(null);
  const [budgetKg, setBudgetKg] = useState("20");
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
  const [suggestionMeta, setSuggestionMeta] = useState<{ title: string; budgetKg: number; usedKg: number } | null>(null);

  // Cart-Box auf Desktop bündig zur "Farbe & Menge"-Box ausrichten
  const stepsAboveRef = useRef<HTMLDivElement>(null);
  const [cartOffset, setCartOffset] = useState(0);

  // Derived
  const selectedSupplier = suppliers.find((s) => s.id === supplierId);
  const hasRegions = (selectedSupplier?.regions?.length ?? 0) > 0;
  const methods = catalogs[supplierId] ?? [];
  const selectedMethod = methods.find((m) => m.id === currentMethod);
  const selectedLength = selectedMethod?.lengths.find((l) => l.id === currentLength);
  const allColors = selectedLength?.colors ?? [];
  const filteredColors = useMemo(() => {
    if (!colorSearch) return allColors;
    const q = colorSearch.toLowerCase();
    return allColors.filter((c) => c.name_hairvenly.toLowerCase().includes(q));
  }, [allColors, colorSearch]);

  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const unit = selectedLength?.unit ?? "g";

  // Cart-Offset: misst die Höhe der Steps 1+2 dynamisch und schiebt
  // die Cart-Box runter, sodass sie bündig mit "Farbe & Menge" startet.
  // Nur auf Desktop (lg-Breakpoint, ab 1024px) — auf Mobile bleibt 0.
  useEffect(() => {
    const el = stepsAboveRef.current;
    if (!el) return;
    const compute = () => {
      const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
      if (selectedLength && isDesktop) {
        // 16 = space-y-4 zwischen den Boxen im linken Stack
        setCartOffset(el.offsetHeight + 16);
      } else {
        setCartOffset(0);
      }
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [selectedLength, supplierId, currentMethod, hasRegions]);

  // Handlers
  const resetSelections = () => {
    setCurrentMethod("");
    setCurrentLength("");
    setCurrentColor(null);
    setCurrentQty("");
    setColorSearch("");
  };

  const handleSupplierChange = (id: string) => {
    setSupplierId(id);
    // Auto-select CN as default if supplier has regions
    const sup = suppliers.find((s) => s.id === id);
    const regions = sup?.regions ?? [];
    setRegion(regions.includes("CN") ? "CN" : regions[0] ?? "");
    resetSelections();
    setItems([]);
    setShowChecker(false);
    setSuggestionMeta(null);
    // Auto-load suggestion meta (non-blocking, fail silently)
    if (sup) {
      getSuggestionMeta(sup.name).then((meta) => {
        if (meta.title) {
          setSuggestionMeta({ title: meta.title, budgetKg: meta.budgetKg ?? 0, usedKg: meta.usedKg ?? 0 });
          setBudgetKg(String(meta.budgetKg ?? 20));
        }
      }).catch(() => {
        // Sheets API not available — that's ok
      });
    }
  };

  const handleMethodChange = (id: string) => {
    setCurrentMethod(id);
    // Auto-select length if only one available
    const method = methods.find((m) => m.id === id);
    if (method?.lengths.length === 1) {
      setCurrentLength(method.lengths[0].id);
    } else {
      setCurrentLength("");
    }
    setCurrentColor(null);
    setCurrentQty("");
    setColorSearch("");
  };

  const handleLengthChange = (id: string) => {
    setCurrentLength(id);
    setCurrentColor(null);
    setCurrentQty("");
    setColorSearch("");
  };

  const addItem = () => {
    if (!currentColor || !currentQty || !selectedMethod || !selectedLength) return;
    const qty = parseInt(currentQty);
    if (isNaN(qty) || qty <= 0) return;

    setItems((prev) => [
      ...prev,
      {
        id: uid(),
        colorId: currentColor.id,
        method: currentMethod,
        methodName: selectedMethod.name,
        length: currentLength,
        color: currentColor.name_hairvenly,
        quantity: qty,
        unit: selectedLength.unit,
      },
    ]);
    setCurrentColor(null);
    setCurrentQty("");
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setShowChecker(false);
  };

  const updateItemQty = (id: string, val: string) => {
    const qty = parseInt(val);
    if (isNaN(qty) || qty <= 0) return;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: qty } : i)));
  };

  // Group items for display
  const grouped = useMemo(() => {
    const groups: Record<string, { label: string; items: CartItem[] }> = {};
    items.forEach((item) => {
      const key = `${item.methodName}-${item.length}`;
      if (!groups[key]) {
        const len = methods
          .find((m) => m.id === item.method)
          ?.lengths.find((l) => l.id === item.length);
        groups[key] = { label: `${item.methodName} · ${len?.value ?? "?"}`, items: [] };
      }
      groups[key].items.push(item);
    });
    return Object.values(groups);
  }, [items, methods]);

  // Export text
  const getExportText = () => {
    const sup = suppliers.find((s) => s.id === supplierId);
    const d = new Date(orderDate).toLocaleDateString("de-DE");
    let text = `${sup?.name ?? "?"} ${d}\n\n`;
    grouped.forEach((g) => {
      text += `--- ${g.label} ---\n`;
      g.items.forEach((i) => { text += `#${i.color}\t${fmt(i.quantity)}\n`; });
      text += "\n";
    });
    text += `Subtotal: ${fmt(totalQty)}${unit}\nPositionen: ${items.length}\n`;
    return text;
  };

  // Build items payload (reused by create + export)
  const buildItemsPayload = () =>
    items.map((i) => ({
      colorId: i.colorId,
      methodName: i.methodName,
      lengthValue: methods.find((m) => m.id === i.method)?.lengths.find((l) => l.id === i.length)?.value ?? "?",
      colorName: i.color,
      quantity: i.quantity,
      unit: i.unit,
    }));

  // Create order + export to Google Sheet
  const handleCreate = () => {
    setError("");
    setStatus("Bestellung wird erstellt...");
    startTransition(async () => {
      const result = await createWizardOrder({
        supplierId,
        orderDate,
        region: region || null,
        notes,
        items: buildItemsPayload(),
      });
      if (result.error) {
        setError(result.error);
        setStatus("");
        return;
      }
      if (result.orderId) {
        // Export to Google Sheets
        setStatus("Wird nach Google Sheets exportiert...");
        const exportResult = await exportOrderToGoogleSheet(result.orderId);
        if (exportResult.error) {
          console.warn("Sheet export:", exportResult.error);
        }

        // Generate PDF
        setStatus("PDF wird erstellt...");
        const pdfResult = await generateAndUploadPDF(result.orderId);
        if (pdfResult.error) {
          console.warn("PDF:", pdfResult.error);
        }

        setStatus("Fertig! Weiterleitung...");
        router.push(`/orders/${result.orderId}`);
      }
    });
  };

  // Import suggestions from Stock Calculation sheet
  const handleImport = () => {
    if (!supplierId) return;
    const supplierName = selectedSupplier?.name ?? "";
    setError("");
    setImportStats(null);

    startImport(async () => {
      const result = await importOrderSuggestions(supplierName);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (!result.suggestions || result.suggestions.length === 0) {
        setError("Keine Bestellvorschläge gefunden");
        return;
      }

      // Match suggestions against catalog
      // Strategy: 1) Match method name, 2) Match length, 3) Match color within that scope
      const newItems: CartItem[] = [];
      const unmatched: string[] = [];
      const seen = new Set<string>(); // Prevent duplicates
      let matched = 0;

      // Method name aliases (sheet name → also try these catalog names)
      const methodAliases: Record<string, string[]> = {
        "classic weft": ["classic weft", "classic tressen"],
        "classic tressen": ["classic tressen", "classic weft"],
        "invisible weft": ["invisible weft", "invisible tressen"],
        "invisible tressen": ["invisible tressen", "invisible weft"],
        "genius weft": ["genius weft", "genius tressen"],
        "genius tressen": ["genius tressen", "genius weft"],
      };

      for (const suggestion of result.suggestions) {
        const sheetMethod = suggestion.method.toLowerCase().trim();
        const sheetLength = suggestion.length.toLowerCase().trim();
        const sheetColor = suggestion.colorCode.replace(/^#/, "").trim().toLowerCase();

        // 1) Find the matching catalog method (with aliases)
        const aliases = methodAliases[sheetMethod] ?? [sheetMethod];
        const catalogMethod = methods.find((m) => {
          const mName = m.name.toLowerCase();
          return aliases.some((a) => mName === a || mName.includes(a) || a.includes(mName));
        });

        if (!catalogMethod) {
          unmatched.push(`${suggestion.colorCode} (Methode "${suggestion.method}" nicht gefunden)`);
          continue;
        }

        // 2) Find matching length
        const catalogLength = catalogMethod.lengths.find((l) =>
          l.value.toLowerCase() === sheetLength
        );

        if (!catalogLength) {
          // Try first length as fallback (most methods have only one)
          const fallbackLength = catalogMethod.lengths[0];
          if (!fallbackLength) {
            unmatched.push(`${suggestion.colorCode} (Länge "${suggestion.length}" nicht gefunden)`);
            continue;
          }
          // Use fallback
          const foundColor = matchColor(fallbackLength.colors, sheetColor);
          if (foundColor) {
            const key = `${catalogMethod.id}-${fallbackLength.id}-${foundColor.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              matched++;
              newItems.push({
                id: uid(), colorId: foundColor.id, method: catalogMethod.id,
                methodName: catalogMethod.name, length: fallbackLength.id,
                color: foundColor.name_hairvenly, quantity: suggestion.orderQty, unit: "g",
              });
            }
          } else {
            unmatched.push(`${suggestion.colorCode} (Farbe nicht im Katalog)`);
          }
          continue;
        }

        // 3) Find matching color within the right method + length
        const foundColor = matchColor(catalogLength.colors, sheetColor);

        if (foundColor) {
          const key = `${catalogMethod.id}-${catalogLength.id}-${foundColor.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            matched++;
            newItems.push({
              id: uid(), colorId: foundColor.id, method: catalogMethod.id,
              methodName: catalogMethod.name, length: catalogLength.id,
              color: foundColor.name_hairvenly, quantity: suggestion.orderQty, unit: "g",
            });
          }
        } else {
          unmatched.push(`${suggestion.colorCode} (Farbe nicht im Katalog für ${catalogMethod.name})`);
        }
      }

      setItems(newItems);
      setImportStats({ total: result.suggestions.length, matched, unmatched });
    });
  };

  /** Match a sheet color code against catalog colors */
  function matchColor(colors: ProductColor[], sheetColor: string): ProductColor | null {
    const sheet = normalizeColor(sheetColor);
    const sheetTokens = colorTokens(sheetColor);

    // 1) name_shopify ist das präziseste Mapping (manuell im Katalog gepflegt).
    //    Erst exakt, dann Substring (eine Seite enthält die andere) — fängt
    //    auch Fälle ab, wo Sheet zusätzliche Suffixe wie "65CM♡" hat.
    for (const c of colors) {
      if (!c.name_shopify) continue;
      const ns = normalizeColor(c.name_shopify);
      if (ns === sheet) return c;
    }
    const byShopifyLen = [...colors]
      .filter((c) => c.name_shopify)
      .sort((a, b) => (b.name_shopify!.length - a.name_shopify!.length));
    for (const c of byShopifyLen) {
      const ns = normalizeColor(c.name_shopify!);
      if (ns.length >= 5 && (sheet.includes(ns) || ns.includes(sheet))) return c;
    }

    // 2) name_supplier match
    for (const c of colors) {
      if (!c.name_supplier) continue;
      const ns = normalizeColor(c.name_supplier);
      if (sheet === ns || sheet.startsWith(ns + " ") || ns.startsWith(sheet + " ")) return c;
    }

    // 3) Exact match on name_hairvenly
    for (const c of colors) {
      if (normalizeColor(c.name_hairvenly) === sheet) return c;
    }

    // 4) name_hairvenly contained anywhere in sheet (longest first to vermeiden,
    //    dass "RAW" vor "RAW RUSSISCHE" matcht)
    const sorted = [...colors].sort((a, b) => b.name_hairvenly.length - a.name_hairvenly.length);
    for (const c of sorted) {
      const nh = normalizeColor(c.name_hairvenly);
      if (nh.length >= 3 && sheet.includes(nh)) return c;
    }

    // 5) Token-Fallback: alle Color-Tokens des Catalog-Eintrags müssen
    //    im Sheet vorkommen (Reihenfolge egal, Stop-Wörter ignoriert).
    //    Fängt Fälle wie "#SOFT BLOND US WELLIGE BALAYAGE TAPE 85CM" gegen
    //    Catalog "SOFT BLOND BALAYAGE", wo "US WELLIGE" zwischen den Color-
    //    Tokens steht.
    for (const c of sorted) {
      const nhTokens = colorTokens(c.name_hairvenly);
      if (nhTokens.size === 0) continue;
      let allPresent = true;
      for (const t of nhTokens) {
        if (!sheetTokens.has(t)) { allPresent = false; break; }
      }
      if (allPresent) return c;
    }

    return null;
  }

  // Load suggestion meta (budget, date) from sheet
  const loadMeta = async () => {
    const meta = await getSuggestionMeta(selectedSupplier?.name ?? "");
    if (meta.title) {
      setSuggestionMeta({ title: meta.title, budgetKg: meta.budgetKg ?? 0, usedKg: meta.usedKg ?? 0 });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{t(locale, "wizard.title")}</h1>
          <p className="text-sm text-neutral-500 mt-1">{t(locale, "wizard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {items.length > 0 && (
            <>
              <button onClick={() => setShowChecker(!showChecker)}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition">
                <Sparkles size={14} /> {t(locale, "wizard.check_order")}
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(getExportText())}
                className="flex items-center gap-2 px-4 py-2 border border-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-50 transition"
                title="Text in Zwischenablage kopieren"
              >
                <Copy size={14} /> {t(locale, "wizard.copy")}
              </button>
              <button onClick={handleCreate} disabled={pending}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition shadow-sm">
                {pending ? (
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <FileText size={14} />
                )}
                {pending ? status || "Wird erstellt..." : "Anlegen + Sheet Export"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
      {status && !error && (
        <div className="flex items-center gap-3 text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <span className="inline-block w-4 h-4 border-2 border-indigo-300 border-t-indigo-700 rounded-full animate-spin shrink-0" />
          {status}
        </div>
      )}
      {importStats && (
        <div className={`text-sm rounded-lg p-3 ${importStats.unmatched.length > 0 ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>
          <strong>{importStats.matched}/{importStats.total}</strong> Positionen importiert.
          {importStats.unmatched.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs">{importStats.unmatched.length} nicht zugeordnet (kein Mapping)</summary>
              <ul className="mt-1 text-xs space-y-0.5 max-h-32 overflow-y-auto">
                {importStats.unmatched.map((u, i) => <li key={i} className="font-mono">{u}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Suggestion Generation Panel */}
      {supplierId && methods.length > 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                <Download size={18} className="text-indigo-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-neutral-900">Bestellvorschlag</h3>
                {suggestionMeta ? (
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                      Budget: {suggestionMeta.budgetKg} kg
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                      Verbraucht: {suggestionMeta.usedKg} kg
                    </span>
                    {(() => {
                      const dateMatch = suggestionMeta.title.match(/(\d{2}\.\d{2}\.\d{4})/);
                      return dateMatch ? (
                        <span className="text-[10px] text-neutral-400">
                          Erstellt: {dateMatch[1]}
                        </span>
                      ) : null;
                    })()}
                    {(() => {
                      const stockSheetId = "1Tmj3jB76yxGjxD1LOrunq5BwV0BCNpayIfoaR7uqj9w";
                      const isAmanda = selectedSupplier?.name?.toLowerCase().includes("amanda");
                      const tabName = isAmanda ? "Vorschlag - Amanda" : "Vorschlag - China";
                      const url = `https://docs.google.com/spreadsheets/d/${stockSheetId}/edit#gid=0`;
                      return (
                        <a href={url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 font-medium">
                          Sheet öffnen <ExternalLink size={10} />
                        </a>
                      );
                    })()}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-400 mt-0.5">Vorschläge aus dem Stock-Sheet laden oder neu generieren</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Budget input */}
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-neutral-500">Budget:</label>
                <input type="number" value={budgetKg} onChange={(e) => setBudgetKg(e.target.value)}
                  className="w-16 px-2 py-1.5 text-sm text-right border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <span className="text-xs text-neutral-400">kg</span>
              </div>
              {/* Generate button — calls Apps Script Web App synchronously */}
              <button
                onClick={async () => {
                  const kg = parseFloat(budgetKg);
                  if (isNaN(kg) || kg <= 0) return;
                  setGenerating(true);
                  setError("");
                  setGenStatus("Bestellvorschlag wird generiert... (kann 2-5 Min. dauern)");
                  setImportStats(null);
                  setSuggestionMeta(null);

                  const result = await triggerSuggestionGeneration(selectedSupplier?.name ?? "", kg);

                  if (result.error) {
                    setError(result.error);
                    setGenerating(false);
                    setGenStatus("");
                    return;
                  }

                  // Script is done — read meta and auto-import
                  setGenStatus("Fertig! Wird importiert...");
                  const meta = await getSuggestionMeta(selectedSupplier?.name ?? "");
                  if (meta.title) {
                    setSuggestionMeta({ title: meta.title, budgetKg: meta.budgetKg ?? 0, usedKg: meta.usedKg ?? 0 });
                  }
                  handleImport();
                  setGenerating(false);
                  setGenStatus("");
                }}
                disabled={generating || importing}
                className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {generating ? (
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {generating ? "Generiert..." : "Neu generieren"}
              </button>
              {/* Import existing suggestions */}
              <button onClick={() => { handleImport(); loadMeta(); }} disabled={importing || generating}
                className="flex items-center gap-2 px-4 py-1.5 border border-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-50 disabled:opacity-50 transition">
                {importing ? (
                  <span className="inline-block w-4 h-4 border-2 border-neutral-300 border-t-neutral-700 rounded-full animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                {importing ? "Importiert..." : "Importieren"}
              </button>
            </div>
          </div>
          {/* Generation status */}
          {genStatus && (
            <div className="mt-3 flex items-center gap-3 text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
              <span className="inline-block w-4 h-4 border-2 border-indigo-300 border-t-indigo-700 rounded-full animate-spin shrink-0" />
              {genStatus}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Builder */}
        <div className="lg:col-span-2 space-y-4">
          {/* Steps 1+2 zusammen — Höhe wird gemessen für Cart-Offset */}
          <div ref={stepsAboveRef} className="space-y-4">
          {/* Step 1: Supplier & Date */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</div>
              <h3 className="text-sm font-semibold text-neutral-900">{t(locale, "wizard.step_supplier")}</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">{t(locale, "wizard.supplier")}</label>
                <select value={supplierId} onChange={(e) => handleSupplierChange(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
                  <option value="">{t(locale, "wizard.supplier_placeholder")}</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">{t(locale, "wizard.order_date")}</label>
                <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
              </div>
            </div>
            {/* Region selector (CN/TR) */}
            {hasRegions && (
              <div className="mt-3">
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1.5">Region</label>
                <div className="flex gap-2">
                  {selectedSupplier?.regions?.map((r) => (
                    <button key={r} onClick={() => setRegion(r)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                        region === r
                          ? r === "CN" ? "bg-red-600 text-white" : "bg-blue-600 text-white"
                          : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                      }`}>
                      {r === "CN" ? "🇨🇳 China" : r === "TR" ? "🇹🇷 Türkei" : r}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Method & Length */}
          {supplierId && methods.length > 0 && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</div>
                <h3 className="text-sm font-semibold text-neutral-900">{t(locale, "wizard.step_method")}</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1.5">{t(locale, "wizard.method")}</label>
                  <div className="flex flex-wrap gap-2">
                    {methods.map((m) => (
                      <button key={m.id} onClick={() => handleMethodChange(m.id)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
                          currentMethod === m.id
                            ? "bg-neutral-900 text-white"
                            : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                        }`}>{m.name}</button>
                    ))}
                  </div>
                </div>
                {selectedMethod && (
                  <div>
                    <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1.5">{t(locale, "wizard.length")}</label>
                    <div className="flex flex-wrap gap-2">
                      {selectedMethod.lengths.map((l) => (
                        <button key={l.id} onClick={() => handleLengthChange(l.id)}
                          className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
                            currentLength === l.id
                              ? "bg-indigo-600 text-white"
                              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                          }`}>{l.value}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          </div>

          {/* Step 3: Colors & Quantity */}
          {selectedLength && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</div>
                  <h3 className="text-sm font-semibold text-neutral-900">{t(locale, "wizard.step_colors")}</h3>
                </div>
                <span className="text-xs text-neutral-400">{allColors.length} {t(locale, "wizard.colors_available")}</span>
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={14} />
                <input type="text" placeholder={t(locale, "wizard.search_color")} value={colorSearch}
                  onChange={(e) => setColorSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900" />
              </div>

              {/* Color grid */}
              <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
                {filteredColors.map((color) => {
                  const isSelected = currentColor?.id === color.id;
                  const inCart = items.some((i) => i.colorId === color.id && i.method === currentMethod && i.length === currentLength);
                  return (
                    <button key={color.id} onClick={() => { setCurrentColor(color); setCurrentQty(""); }}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium text-left transition ${
                        isSelected
                          ? "bg-indigo-50 border-2 border-indigo-400 text-indigo-700"
                          : inCart
                          ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                          : "bg-neutral-50 border border-neutral-150 text-neutral-700 hover:bg-neutral-100"
                      }`}>
                      <span className="truncate">#{color.name_hairvenly}</span>
                      {inCart && <Check size={14} className="text-emerald-500 ml-auto shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Quantity input */}
              {currentColor && (
                <div className="mt-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-sm font-bold text-indigo-700">#{currentColor.name_hairvenly}</span>
                      <span className="text-xs text-indigo-500 ml-2">{selectedMethod?.name} {selectedLength.value}</span>
                    </div>
                    <button onClick={() => setCurrentColor(null)} className="text-indigo-400 hover:text-indigo-600">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input type="number" placeholder={`${t(locale, "wizard.quantity_placeholder")} ${unit}`}
                        value={currentQty} onChange={(e) => setCurrentQty(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addItem()}
                        className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        autoFocus />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{unit}</span>
                    </div>
                    <button onClick={addItem} disabled={!currentQty || parseInt(currentQty) <= 0}
                      className="flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-40 transition">
                      <Plus size={14} /> {t(locale, "wizard.add")}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {QUANTITY_PRESETS.map((q) => (
                      <button key={q} onClick={() => setCurrentQty(String(q))}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                          currentQty === String(q)
                            ? "bg-neutral-900 text-white"
                            : "bg-white text-neutral-500 hover:bg-indigo-100 border border-indigo-200"
                        }`}>{fmt(q)}{unit}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!supplierId && (
            <div className="text-center py-12">
              <ClipboardList size={48} className="text-neutral-200 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-neutral-400">{t(locale, "wizard.start_hint")}</h3>
              <p className="text-sm text-neutral-300 mt-1">{t(locale, "wizard.start_hint_sub")}</p>
            </div>
          )}
        </div>

        {/* Right: Cart + Checker + Export — schiebt sich auf Desktop bündig zur "Farbe & Menge"-Box runter */}
        <div
          className="space-y-4 transition-[margin-top] duration-300 ease-out"
          style={{ marginTop: cartOffset }}
        >
          {/* Cart */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ShoppingCart size={16} className="text-neutral-400" />
                <h3 className="text-sm font-semibold text-neutral-900">{t(locale, "wizard.cart")}</h3>
              </div>
              {items.length > 0 && (
                <span className="text-[10px] font-bold text-white bg-neutral-900 px-2 py-0.5 rounded-full">{items.length}</span>
              )}
            </div>

            {items.length === 0 ? (
              <div className="text-center py-8">
                <Package size={32} className="text-neutral-200 mx-auto mb-2" />
                <p className="text-sm text-neutral-400">{t(locale, "wizard.cart_empty")}</p>
                <p className="text-xs text-neutral-300 mt-1">{t(locale, "wizard.cart_empty_hint")}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {grouped.map((g, gi) => {
                  const groupQty = g.items.reduce((s, i) => s + i.quantity, 0);
                  return (
                    <CartGroup key={gi} label={g.label} count={g.items.length} totalQty={groupQty} unit={g.items[0]?.unit ?? "g"}>
                      {g.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-1.5 py-1 group">
                          <span className="text-[11px] font-medium text-neutral-700 flex-1 truncate">#{item.color}</span>
                          <input type="number" value={item.quantity}
                            onChange={(e) => updateItemQty(item.id, e.target.value)}
                            className="w-[60px] px-1.5 py-0.5 text-[11px] text-right font-semibold bg-white border border-neutral-200 rounded focus:outline-none focus:ring-1 focus:ring-neutral-400 tabular-nums" />
                          <span className="text-[9px] text-neutral-400 w-3">{item.unit}</span>
                          <button onClick={() => removeItem(item.id)}
                            className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-red-500 transition shrink-0">
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                    </CartGroup>
                  );
                })}
              </div>
            )}

            {items.length > 0 && (
              <div className="mt-3 pt-3 border-t border-neutral-100">
                <div className="flex justify-between text-xs text-neutral-500 mb-1">
                  <span>{t(locale, "wizard.positions")}:</span>
                  <span className="font-semibold">{items.length}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-neutral-900">
                  <span>{t(locale, "wizard.total_quantity")}:</span>
                  <span>{fmt(totalQty)} {unit}</span>
                </div>
                <button onClick={() => { setItems([]); setImportStats(null); }}
                  className="mt-2 text-[10px] text-red-500 hover:text-red-700 font-medium">
                  Alle entfernen
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          {items.length > 0 && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1.5">{t(locale, "wizard.notes")}</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
            </div>
          )}

          {/* Checker */}
          {showChecker && items.length > 0 && (
            <CheckerResults items={items} locale={locale} />
          )}

          {/* Export */}
          {showExport && items.length > 0 && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-neutral-900">{t(locale, "wizard.export")}</h3>
                <button onClick={() => navigator.clipboard.writeText(getExportText())}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 rounded-lg text-xs font-medium text-neutral-600 hover:bg-neutral-200 transition">
                  <Copy size={12} /> {t(locale, "wizard.copy")}
                </button>
              </div>
              <pre className="text-[11px] font-mono text-neutral-600 bg-neutral-50 rounded-xl p-3 max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                {getExportText()}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckerResults({ items, locale }: { items: CartItem[]; locale: Locale }) {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Check for duplicates
  const seen = new Set<string>();
  items.forEach((item) => {
    const key = `${item.method}-${item.length}-${item.color}`;
    if (seen.has(key)) {
      warnings.push(`Doppelter Eintrag: ${item.color} (${item.methodName}) - bitte zusammenführen`);
    }
    seen.add(key);
  });

  // High quantities
  items.forEach((item) => {
    if (item.quantity >= 2000) {
      suggestions.push(`Hohe Menge: ${item.color} — ${fmt(item.quantity)}${item.unit} (${item.methodName})`);
    }
  });

  // Low quantities
  items.forEach((item) => {
    if (item.quantity < 200) {
      suggestions.push(`Kleine Menge: ${item.color} nur ${fmt(item.quantity)}${item.unit} — lohnt sich das?`);
    }
  });

  const approvedCount = items.length - warnings.length;

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-amber-500" />
        <h3 className="text-sm font-semibold text-neutral-900">{t(locale, "wizard.checker_title")}</h3>
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[10px] font-bold text-red-500 uppercase tracking-wider">{t(locale, "wizard.checker_warnings")}</h4>
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 bg-red-50 rounded-lg">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
              <span className="text-xs text-red-700">{w}</span>
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">{t(locale, "wizard.checker_suggestions")}</h4>
          {suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 bg-amber-50 rounded-lg">
              <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
              <span className="text-xs text-amber-700">{s}</span>
            </div>
          ))}
        </div>
      )}

      <div className="p-2.5 bg-emerald-50 rounded-lg flex items-center gap-2">
        <CheckCircle2 size={14} className="text-emerald-500" />
        <span className="text-xs text-emerald-700">
          {approvedCount}/{items.length} {t(locale, "wizard.checker_ok")}
        </span>
      </div>
    </div>
  );
}

/** Collapsible cart group */
function CartGroup({ label, count, totalQty, unit, children }: {
  label: string; count: number; totalQty: number; unit: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-neutral-100 overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-50 hover:bg-neutral-100 transition text-left">
        {open ? <ChevronDown size={12} className="text-neutral-400" /> : <ChevronRight size={12} className="text-neutral-400" />}
        <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider flex-1">{label}</span>
        <span className="text-[10px] text-neutral-400 tabular-nums">{count} · {fmt(totalQty)}{unit}</span>
      </button>
      {open && <div className="px-2.5 pb-1.5 divide-y divide-neutral-50">{children}</div>}
    </div>
  );
}
