/**
 * POST /api/chatbot/sync-treatwell-services
 *
 * Scrapt die Treatwell-Seite (https://buchung.treatwell.de/ort/hairvenly-…)
 * und sync't die Services in die `salon_services`-Tabelle.
 *
 * Sync-Strategie:
 *   - Pro gescrapter Service-Zeile: upsert by (treatment_id, variant_name)
 *     via Match auf bestehende Zeilen mit gleichem `service`-Namen
 *   - Bestehende Zeilen, die in der aktuellen Scrape NICHT vorkommen,
 *     werden auf `active = false` gesetzt (nicht hart gelöscht)
 *   - Neue Zeilen werden mit `active = true` eingefügt
 *
 * Nutzt das Treatwell-`group` als `category`, `treatment_name` (+ optional
 * `variant_name`) als `service`. `display_order` wird automatisch gesetzt
 * (Gruppen-Index * 100 + Item-Index).
 *
 * Nur Admin (requireAdmin).
 */
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { scrapeTreatwellServices, type TreatwellService } from "@/lib/treatwell/scraper";

export const maxDuration = 30;

interface SalonServiceRow {
  id: string;
  category: string;
  service: string;
  price_min: number | null;
  price_max: number | null;
  duration_min: number | null;
  notes: string | null;
  display_order: number;
  active: boolean;
}

/** Treatwell-Group → DB-Category-Label */
function mapCategory(s: TreatwellService): string {
  // Verfeinerung der Treatment-Gruppen — die Standard-Treatwell-Gruppe
  // "Haarverlängerung" ist zu grob; die MA wollen "Tapes Russisch" vs
  // "Bondings Usbekisch" sehen können.
  const t = s.treatment_name.toLowerCase();
  if (t.includes("tape extensions") && t.includes("glatt")) return "Tapes Russisch (glatt 60cm)";
  if (t.includes("tape extensions") && t.includes("wellig")) return "Tapes Usbekisch (wellig 45-65cm)";
  if (t.includes("tape extensions xxl")) return "Tapes XXL (85cm)";
  if (t.includes("mini tape") && t.includes("glatt")) return "Mini Tapes Russisch (glatt 60cm)";
  if (t.includes("mini tape") && t.includes("wellig")) return "Mini Tapes Usbekisch (wellig)";
  if (t.includes("bonding") && t.includes("xxl")) return "Bondings XXL (85cm)";
  if (t.includes("bonding") && t.includes("glatt")) return "Bondings Russisch (glatt 60cm)";
  if (t.includes("bonding") && t.includes("wellig")) return "Bondings Usbekisch (wellig 65cm)";
  if (t.includes("invisible tressen")) return "Invisible Tressen Russisch (glatt 60cm)";
  if (t.includes("genius weft") && t.includes("glatt")) return "Genius Weft Russisch (glatt)";
  if (t.includes("genius weft") && t.includes("wellig")) return "Genius Weft Usbekisch (wellig)";
  if (t.includes("standart tressen") || t.includes("tressen extensions") && t.includes("glatt")) return "Tressen Russisch (glatt 60cm)";
  if (t.includes("tressen extensions") && t.includes("wellig")) return "Tressen Usbekisch (wellig 45-65cm)";
  if (t.includes("hochsetzen") && t.includes("tape")) return "Tapes hochsetzen";
  if (t.includes("hochsetzen") && t.includes("mini")) return "Mini Tapes hochsetzen";
  if (t.includes("hochsetzen") && t.includes("tressen") && t.includes("invisible")) return "Invisible Tressen hochsetzen";
  if (t.includes("hochsetzen") && t.includes("tressen")) return "Tressen hochsetzen";
  if (t.includes("hochsetzen") && t.includes("fremdarbeit")) return "Tapes hochsetzen (Fremdarbeit)";
  if (t.includes("entfernen")) return "Entfernen";
  if (t.includes("bonding kontrolle")) return "Bondings (Kontrolle)";
  if (t.includes("beratung")) return "Beratung";
  // Coloration / Strähnen / Balayage
  if (t.includes("balayage")) return "Balayage";
  if (t.includes("strähnen")) return "Strähnen";
  if (t.includes("farbe") || t.includes("tönung") || t.includes("ansatz") || t.includes("glossing") || t.includes("face framing") || t.includes("coloration")) return "Coloration";
  // Schnitt
  if (t.includes("schneiden") || t.includes("föhnen") || t.includes("styling")) return "Schnitt & Styling";
  // Augenbrauen / Wimpern
  if (t.includes("wimpern") || t.includes("augenbrauen")) return "Augenbrauen & Wimpern";
  return s.group; // Fallback: Treatwell-Gruppen-Name
}

/** Service-Label bauen (Treatment-Name + ggf. Variante) */
function buildServiceLabel(s: TreatwellService): string {
  if (s.variant_name && s.variant_name !== s.treatment_name) {
    return `${s.treatment_name} – ${s.variant_name}`;
  }
  return s.treatment_name;
}

export async function POST() {
  const profile = await requireProfile();
  if (!profile.is_admin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  // 1) Treatwell-Scrape
  let scrape: Awaited<ReturnType<typeof scrapeTreatwellServices>>;
  try {
    scrape = await scrapeTreatwellServices();
  } catch (e) {
    return NextResponse.json(
      { error: "Scrape fehlgeschlagen", details: (e as Error).message },
      { status: 502 }
    );
  }
  if (scrape.services.length === 0) {
    return NextResponse.json(
      { error: "Scrape lieferte 0 Services — Treatwell-Markup hat sich evtl. geändert" },
      { status: 502 }
    );
  }

  // 2) Bestehende salon_services laden (für Diff + Deaktivieren obsoleter)
  const svc = createServiceClient();
  const { data: existingRaw } = await svc
    .from("salon_services")
    .select("id, category, service, price_min, price_max, duration_min, notes, display_order, active");
  const existing = (existingRaw || []) as SalonServiceRow[];
  const existingByLabel = new Map<string, SalonServiceRow>();
  for (const row of existing) {
    existingByLabel.set(row.service.toLowerCase().trim(), row);
  }

  // 3) Pro Scrape-Eintrag: upsert
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const seenLabels = new Set<string>();
  // display_order: Reihenfolge der Scrape behalten — 10er-Schritte für spätere Einschübe
  let order = 10;
  for (const s of scrape.services) {
    const label = buildServiceLabel(s);
    const labelKey = label.toLowerCase().trim();
    seenLabels.add(labelKey);
    const category = mapCategory(s);
    const noteParts: string[] = [];
    if (s.treatment_id) noteParts.push(`tw_id=${s.treatment_id}`);
    if (s.description) noteParts.push(s.description);
    const notes = noteParts.join(" | ") || null;
    const row = {
      category,
      service: label,
      price_min: s.price_min,
      price_max: s.price_max,
      duration_min: s.duration_min,
      notes,
      display_order: order,
      active: true,
    };
    order += 10;

    const old = existingByLabel.get(labelKey);
    if (!old) {
      await svc.from("salon_services").insert(row);
      inserted++;
    } else {
      // Diff: nur updaten wenn sich was geändert hat
      const changed =
        old.category !== row.category ||
        old.price_min !== row.price_min ||
        old.price_max !== row.price_max ||
        old.duration_min !== row.duration_min ||
        !old.active ||
        (old.notes || "") !== (row.notes || "");
      if (changed) {
        await svc
          .from("salon_services")
          .update({
            category: row.category,
            price_min: row.price_min,
            price_max: row.price_max,
            duration_min: row.duration_min,
            notes: row.notes,
            display_order: row.display_order,
            active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", old.id);
        updated++;
      } else {
        unchanged++;
      }
    }
  }

  // 4) Obsolet gewordene Services auf active=false setzen
  //    (nicht hart löschen — Historie/Audit bleibt)
  const toDeactivate = existing.filter(
    (r) => r.active && !seenLabels.has(r.service.toLowerCase().trim())
  );
  let deactivated = 0;
  for (const row of toDeactivate) {
    await svc
      .from("salon_services")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    deactivated++;
  }

  return NextResponse.json({
    ok: true,
    source_url: scrape.sourceUrl,
    scraped_at: scrape.scrapedAt,
    scraped_count: scrape.services.length,
    inserted,
    updated,
    unchanged,
    deactivated,
  });
}
