"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface ReservationInput {
  sessionId?: string;
  productName: string;
  productUrl?: string;
  color?: string;
  method?: string;
  etaHint?: string;
  notes?: string;
}

/**
 * Validiert ob eine product_url konsistent zur method ist.
 * Bug-Pattern: Bot speichert URL aus letztem get_available_colors-Tool-Result,
 * die zu einer ANDEREN Method gehört als die in der Reservation gesetzte.
 * Beispiel: method="Standard Tapes" + url=".../mini-tape-extensions..." → falsch.
 *
 * Returns die URL wenn konsistent, sonst null. Konservativ: bei Unsicherheit
 * lieber null als falscher Link.
 *
 * NOTE: Keine Server-Action — private Helper (deshalb nicht exported, da
 * "use server" Modul nur async exports erlaubt).
 */
function validateProductUrlAgainstMethod(
  url: string | undefined,
  method: string | undefined,
): string | null {
  if (!url) return null;
  if (!method) return url; // ohne method-Info kein Check möglich, durchlassen
  const m = method.toLowerCase();
  const u = url.toLowerCase();

  // Method-Klassifizierung
  const isStandard = /\b(standard\s*tape|standard.tape)/i.test(method) && !/mini/i.test(method);
  const isMini     = /mini\s*tape/i.test(method);
  const isBonding  = /\bbonding/i.test(method);
  const isTresse   = /\b(tresse|tressen|weft)/i.test(method) && !/clip/i.test(method);
  const isClip     = /\b(clip[- ]?in|clip[- ]?on)/i.test(method);
  const isPonytail = /\bponytail/i.test(method);

  // URL-Slug-Klassifizierung
  const urlHasMini     = /mini[- ]tape/i.test(url);
  const urlHasStandard = /standard[- ]tape/i.test(url);
  const urlHasBonding  = /bonding/i.test(url);
  const urlHasTresse   = /(tresse|weft)/i.test(url) && !/clip/i.test(url);
  const urlHasClip     = /clip[- ]?in|clip[- ]?ext/i.test(url);
  const urlHasPonytail = /ponytail/i.test(url);
  const urlHasTape     = /tape/i.test(url);

  // Widerspruchs-Check
  if (isStandard && urlHasMini) return null;          // Standard ≠ Mini
  if (isMini && urlHasStandard) return null;          // Mini ≠ Standard
  if (isBonding && !urlHasBonding && urlHasTape) return null;   // Bonding ≠ Tape
  if (isTresse && (urlHasTape || urlHasClip || urlHasBonding)) return null;  // Tresse ≠ andere
  if (isClip && (urlHasTape || urlHasBonding || urlHasTresse)) return null;  // Clip ≠ andere
  if (isPonytail && !urlHasPonytail) return null;      // Ponytail muss Slug haben
  // Wenn method "tape" sagt und url keinen "tape" hat → vermutlich falsche Kategorie
  if (/\btape/i.test(method) && !urlHasTape && (urlHasBonding || urlHasClip || urlHasTresse)) {
    return null;
  }

  void u; void m; // (lint) — Variables reserved for future synonym-checks
  return url;
}

/**
 * Reservierung anlegen — wird vom Bot-Tool aufgerufen (create_reservation)
 * oder manuell vom Mitarbeiter. Session-Daten (channel, external_id, customer_name)
 * werden aus der Session gespiegelt, damit der spätere Notification-Versand
 * nicht von der Session abhängt.
 */
export async function createReservation(input: ReservationInput, createdByBot = true) {
  const svc = createServiceClient();

  let session: { channel: string | null; external_id: string | null; customer_name: string | null } | null = null;
  if (input.sessionId) {
    const { data } = await svc
      .from("chat_sessions")
      .select("channel, external_id, customer_name")
      .eq("id", input.sessionId)
      .single();
    session = data;
  }

  // URL-Method-Validator: Bot liefert manchmal URL aus dem letzten
  // get_available_colors-Output, der zur FALSCHEN Method gehört.
  // Beispiel-Bug (User-Report 2026-05): method="Standard Tapes" aber URL
  // hat slug "...mini-tape...". Konservativ: bei Widerspruch URL droppen,
  // MA findet richtigen Link selbst — besser als falscher Link.
  const validatedUrl = validateProductUrlAgainstMethod(input.productUrl, input.method);

  const { data, error } = await svc.from("chat_reservations").insert({
    session_id:    input.sessionId || null,
    customer_name: session?.customer_name || null,
    channel:       session?.channel || null,
    external_id:   session?.external_id || null,
    product_name:  input.productName,
    product_url:   validatedUrl,
    color:         input.color || null,
    method:        input.method || null,
    eta_hint:      input.etaHint || null,
    notes:         input.notes || null,
    status:        "waiting",
    created_by_bot: createdByBot,
  }).select().single();

  if (error) throw new Error(error.message);
  revalidatePath("/chatbot/reservations");
  return data;
}

/** Reservierung manuell vom Mitarbeiter anlegen */
export async function createReservationManual(formData: FormData) {
  const input: ReservationInput = {
    sessionId:   (formData.get("session_id") as string) || undefined,
    productName: formData.get("product_name") as string,
    productUrl:  (formData.get("product_url") as string) || undefined,
    color:       (formData.get("color") as string) || undefined,
    method:      (formData.get("method") as string) || undefined,
    etaHint:     (formData.get("eta_hint") as string) || undefined,
    notes:       (formData.get("notes") as string) || undefined,
  };
  if (!input.productName?.trim()) throw new Error("Produktname fehlt");
  await createReservation(input, false);
}

/**
 * Standard-Nachricht für eine Reservierung — wird im UI vorausgefüllt,
 * Mitarbeiter kann editieren bevor er sendet.
 */
export async function defaultNotificationText(reservationId: string): Promise<string> {
  const svc = createServiceClient();
  const { data: r } = await svc
    .from("chat_reservations")
    .select("product_name, color, method, product_url, customer_name")
    .eq("id", reservationId).single();
  if (!r) return "";
  const prod = [r.color, r.method].filter(Boolean).join(" ").trim() || r.product_name;
  let txt = `Hallo Liebes 💕\n\nGute Nachrichten — die ${prod} sind jetzt wieder da! 🥳`;
  if (r.product_url) txt += `\n\n${r.product_url}`;
  txt += `\n\nMagst du sie noch? Sag Bescheid wenn ich dir weiterhelfen soll 🩷`;
  return txt;
}

/**
 * Sendet die Reservierungs-Nachricht an den ursprünglichen Channel
 * + erzeugt eine human_agent-Message im Chat (damit es im Verlauf sichtbar bleibt).
 */
export async function sendReservationNotification(reservationId: string, customText?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  const { data: r } = await svc.from("chat_reservations").select("*").eq("id", reservationId).single();
  if (!r) throw new Error("Reservierung nicht gefunden");
  if (r.status !== "waiting") throw new Error("Reservierung ist nicht mehr offen");

  const text = (customText || await defaultNotificationText(reservationId)).trim();
  if (!text) throw new Error("Leerer Text");

  // Versand
  if (r.channel === "instagram" && r.external_id) {
    const { sendInstagramMessage } = await import("@/lib/messaging/meta");
    const result = await sendInstagramMessage(r.external_id, text);
    if (!result.success) throw new Error(`IG send failed: ${result.error}`);
  } else if (r.channel === "whatsapp" && r.external_id) {
    const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
    const result = await sendWhatsAppMessage(r.external_id, text);
    if (!result.success) throw new Error(`WA send failed: ${result.error}`);
  }

  // Chat-Message-Eintrag (damit es im Verlauf erscheint)
  if (r.session_id) {
    await svc.from("chat_messages").insert({
      session_id: r.session_id,
      role:       "human_agent",
      content:    text,
      agent_id:   user.id,
    });
    await svc.from("chat_sessions").update({
      last_message_at:       new Date().toISOString(),
      last_seen_by_agent_at: new Date().toISOString(),
    }).eq("id", r.session_id);
  }

  // Status aktualisieren
  await svc.from("chat_reservations").update({
    status:               "notified",
    notified_at:          new Date().toISOString(),
    notified_by:          user.id,
    notification_message: text,
  }).eq("id", reservationId);

  revalidatePath("/chatbot/reservations");
  if (r.session_id) revalidatePath(`/chatbot/inbox/${r.session_id}`);
}

/** Reservierung stornieren (z.B. Kundin hat sich anderweitig entschieden) */
export async function cancelReservation(reservationId: string, reason?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  await svc.from("chat_reservations").update({
    status:        "cancelled",
    cancelled_at:  new Date().toISOString(),
    cancelled_by:  user.id,
    cancel_reason: reason || null,
  }).eq("id", reservationId);
  revalidatePath("/chatbot/reservations");
}

/** Notizen aktualisieren */
export async function updateReservationNotes(reservationId: string, notes: string) {
  const svc = createServiceClient();
  await svc.from("chat_reservations").update({ notes }).eq("id", reservationId);
  revalidatePath("/chatbot/reservations");
}

export interface StockCheckResult {
  reservationId: string;
  productName: string;
  status: "in_stock" | "unterwegs" | "out_of_stock" | "unknown" | "service_item";
  eta?: string;
  matchedProduct?: string;
  reason?: string;
}

/**
 * Lager-Scan: prüft für jede "waiting" Reservierung, ob das Produkt aktuell
 * im Lager / unterwegs / ausverkauft ist. Liest aus den Stock-Sheets
 * (gleiche Quelle wie das get_stock_eta Tool des Bots) — keine extra DB,
 * keine extra Auflösung nötig.
 */
export async function scanReservationsAgainstStock(): Promise<StockCheckResult[]> {
  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("chat_reservations")
    .select("id, product_name, color, method")
    .eq("status", "waiting");

  if (!rows || rows.length === 0) return [];

  const { readDashboardAlerts, readInventorySheet } = await import("@/lib/stock-sheets");
  const [{ unterwegs, nullbestand }, ruSheet, uzSheet] = await Promise.all([
    readDashboardAlerts(),
    readInventorySheet("Russisch - GLATT"),
    readInventorySheet("Usbekisch - WELLIG"),
  ]);
  // 🔑 LINE-AWARENESS: jede Inventory-Row trägt jetzt ihre Linie aus dem
  // Sheet-Namen — verhindert falsche Cross-Line-Matches (z.B. "Mocha Melt
  // US Wellige Tape" matchte fälschlich "MOCHAMELT STANDARD RUSSISCHE TAPE").
  type LineTaggedRow = (typeof ruSheet.rows)[number] & { _line: "russisch" | "usbekisch" };
  const allInventory: LineTaggedRow[] = [
    ...ruSheet.rows.map(r => ({ ...r, _line: "russisch" as const })),
    ...uzSheet.rows.map(r => ({ ...r, _line: "usbekisch" as const })),
  ];

  // Line-Extraction aus Sheet-Row (für unterwegs/nullbestand die collection-Strings haben)
  const extractLineFromText = (text: string): "russisch" | "usbekisch" | null => {
    const t = text.toLowerCase();
    if (/\b(russisch|russische|glatt|glatte|ru\s*glatt)\b/.test(t)) return "russisch";
    if (/\b(usbekisch|usbekische|wellig|wellige|us\s*wellig)\b/.test(t)) return "usbekisch";
    return null;
  };

  // STOP-Words: NUR reine Beschreiber, die KEINE Method/Subtype-Bedeutung haben.
  // ⚠️ NICHT IN STOP (wichtig!): tape/tapes/extension/extensions/standard/mini/
  //    genius/classic/invisible/bondings/tressen/clip/weft/ponytail — diese
  //    Tokens unterscheiden Method×Subtype und MÜSSEN im Match drinbleiben,
  //    sonst matched z.B. "Standard Tape" fälschlich gegen "Invisible Clip Extensions"
  //    nur weil beide die gleiche Farbe haben. (Bug-Report 2026-05)
  const STOP = new Set([
    "und", "in", "die", "der", "das", "den", "ein", "eine", "mit", "für", "auf",
    "russisch", "russische", "russischer", "usbekisch", "usbekische", "usbekischer",
    "us", "wellige", "wellig", "glatt", "glatte", "glatten",
    "echthaar", "echte", "haar", "haare",
    "braun", "braune", "brauner", "blond", "blonde", "blonder",
    "balayage", "ombre", "ombré", "solide",
    "premium", "luxury",
  ]);

  // Service-Items (nicht Inventar) — Klasse C
  const SERVICE_ITEM_RE = /^\s*(farbring|farbprobe|broschüre|broschuere|pflegeset|musterset|katalog|beratung|gutschein|voucher)\s*$/i;

  // Gewicht-/Längen-Token aus Suchstring extrahieren (Klasse B):
  // Sheet hat unitWeight als eigene Spalte, NICHT im Produktnamen → "150g"
  // muss als separates Filter dienen, nicht als Substring-Token.
  const GRAM_RE = /(\d{2,4})\s*g(?:ramm)?\b/i;
  const LENGTH_CM_RE = /(\d{2,3})\s*cm\b/i;

  const tokenize = (s: string): string[] => {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9äöüß/\s\-]+/gi, " ")
      .split(/[\s\-]+/)
      .filter(t => t && t.length > 1 && !STOP.has(t));
  };

  // Subtype-Awareness: "Standard Tapes" ist DEFAULT — Sheet-Collections im
  // Usbekisch-Bereich heißen nur "Tapes Wellig 65cm" (ohne expliziten
  // "Standard"-Prefix). Wir strippen "standard" aus tokens UND verlangen
  // dass haystack KEINEN expliziten anderen Subtype enthält
  // (Mini/Genius/Classic/Invisible). So matched Standard ↔ ungenanntes
  // Subtype, ohne fälschlich Mini/Genius zu treffen.
  const classifySubtype = (s: string | undefined): {
    wantsMini: boolean; wantsGenius: boolean; wantsClassic: boolean; wantsInvisible: boolean; wantsDefault: boolean;
  } => {
    const txt = (s || "").toLowerCase();
    const wantsMini = /\bmini\b/.test(txt);
    const wantsGenius = /\bgenius\b/.test(txt);
    const wantsClassic = /\bclassic\b/.test(txt);
    const wantsInvisible = /\b(invisible|butterfly)\b/.test(txt);
    return {
      wantsMini, wantsGenius, wantsClassic, wantsInvisible,
      wantsDefault: !wantsMini && !wantsGenius && !wantsClassic && !wantsInvisible,
    };
  };

  // Match-Helper mit Plural-Toleranz + Subtype-Conflict-Check
  const matchTokens = (toks: string[], wants: ReturnType<typeof classifySubtype>) => (text: string) => {
    const hay = text.toLowerCase();
    // Token-Substring-Check (mit Plural-Toleranz)
    for (const t of toks) {
      if (hay.includes(t)) continue;
      if (t.length > 2 && t.endsWith("s") && hay.includes(t.slice(0, -1))) continue;
      if (t.length > 3 && t.endsWith("en") && hay.includes(t.slice(0, -2))) continue;
      return false;
    }
    // Subtype-Conflict-Check: haystack-Subtype muss zu wants passen
    const hayMini = /\bmini[\s-]?tape/i.test(text);
    const hayGenius = /\bgenius\b/i.test(text);
    const hayClassic = /\bclassic\b/i.test(text);
    // ⚠️ Wichtig: Bei Clip-Extensions ist "Invisible" Marken-Bestandteil (alle
    // Hairvenly-Clip-Ins heißen "Invisible Clip Extensions"), KEIN Subtype.
    // Bei Tape/Tresse/Bonding hingegen IST "Invisible" ein echter Subtype
    // (Invisible Wefts / Butterfly Wefts).
    // → Invisible-Subtype-Check nur wenn search NICHT explizit Clip ist.
    const searchIsClip = toks.some(t => /^clip$/i.test(t)) || toks.some(t => /^ins$/i.test(t));
    const hayInvisible = /\b(invisible|butterfly)\b/i.test(text);
    if (wants.wantsMini !== hayMini) return false;
    if (wants.wantsGenius !== hayGenius) return false;
    if (wants.wantsClassic !== hayClassic) return false;
    if (!searchIsClip && wants.wantsInvisible !== hayInvisible) return false;
    return true;
  };

  const results: StockCheckResult[] = [];
  for (const r of rows) {
    // SERVICE-ITEM-Check FRÜH (Klasse C) — "Farbring" etc. sind nicht im Lager
    if (SERVICE_ITEM_RE.test(r.product_name || "")) {
      results.push({
        reservationId: r.id,
        productName: r.product_name,
        status: "service_item",
        reason: "Kein Inventar-Item — separat handhaben (Marketing/Service)",
      });
      continue;
    }

    const searchStr = [r.color, r.method, r.product_name].filter(Boolean).join(" ");

    // Gewicht-/Längen-Filter extrahieren (Klasse B)
    let targetGrams: number | null = null;
    let targetLengthCm: number | null = null;
    const gMatch = searchStr.match(GRAM_RE);
    if (gMatch) targetGrams = parseInt(gMatch[1], 10);
    const lMatch = searchStr.match(LENGTH_CM_RE);
    if (lMatch) targetLengthCm = parseInt(lMatch[1], 10);
    // Gewicht- und Längen-Marker aus dem Suchstring entfernen — werden
    // jetzt als separates Match-Kriterium gegen unitWeight bzw. Produktname behandelt.
    const cleanedSearch = searchStr
      .replace(GRAM_RE, " ")
      .replace(LENGTH_CM_RE, " ");

    // Subtype-Klassifizierung: basiert auf method UND product_name, weil
    // manche Reservierungen den Subtype nur im product_name haben.
    const subtypeSrc = `${r.method || ""} ${r.product_name || ""}`;
    const wants = classifySubtype(subtypeSrc);

    // 🔑 LINE-Extraction aus Reservierung: explizite Schlüsselworte
    // ("us wellige", "russisch", etc.) → Filter auf gleiche Linie im Sheet.
    // Wenn KEINE Linie genannt → unspecified, matched gegen beide Linien.
    const reservationLine = extractLineFromText(searchStr);

    // "standard" ist DEFAULT-Subtype → strip aus tokens (sonst scheitert
    // Match gegen Usbekisch-Sheet wo die Collection nur "Tapes Wellig" heißt,
    // kein "Standard"-Prefix). Bei wantsMini/Genius/Classic/Invisible bleibt
    // der explizite Subtype-Token natürlich im Set.
    let tokens = tokenize(cleanedSearch);
    if (wants.wantsDefault) {
      tokens = tokens.filter(t => t !== "standard");
    }
    if (tokens.length === 0) {
      results.push({ reservationId: r.id, productName: r.product_name, status: "unknown", reason: "Keine identifizierbaren Such-Tokens" });
      continue;
    }
    const tokenMatch = matchTokens(tokens, wants);

    // Match-Helper: berücksichtigt Tokens + Subtype + Gewicht + Länge + Linie
    const fullMatch = (row: { collection?: string; product?: string; unitWeight?: number; _line?: "russisch" | "usbekisch" }) => {
      const text = `${row.collection || ""} ${row.product || ""}`;
      // 🔑 LINIEN-FILTER: wenn Reservierung explizite Linie hat, MUSS row dazu passen
      if (reservationLine) {
        const rowLine = row._line || extractLineFromText(row.collection || "");
        if (rowLine && rowLine !== reservationLine) return false;
      }
      if (!tokenMatch(text)) return false;
      if (targetGrams !== null && row.unitWeight && Math.abs(row.unitWeight - targetGrams) > 5) return false;
      if (targetLengthCm !== null) {
        const productLengthMatch = text.match(LENGTH_CM_RE);
        if (productLengthMatch && parseInt(productLengthMatch[1], 10) !== targetLengthCm) return false;
      }
      return true;
    };

    const stocked = allInventory.filter(row => fullMatch(row) && row.quantity > 0);
    if (stocked.length > 0) {
      results.push({
        reservationId: r.id,
        productName: r.product_name,
        status: "in_stock",
        matchedProduct: stocked[0].product,
      });
      continue;
    }
    const onTheWay = unterwegs.filter(u => fullMatch(u));
    if (onTheWay.length > 0) {
      const eta = onTheWay[0].perOrder?.[0]?.ankunft || "bald";
      results.push({
        reservationId: r.id,
        productName: r.product_name,
        status: "unterwegs",
        eta,
        matchedProduct: onTheWay[0].product,
      });
      continue;
    }
    const oos = nullbestand.filter(p => fullMatch(p));
    if (oos.length > 0) {
      results.push({
        reservationId: r.id,
        productName: r.product_name,
        status: "out_of_stock",
        matchedProduct: oos[0].product,
      });
      continue;
    }
    results.push({ reservationId: r.id, productName: r.product_name, status: "unknown" });
  }
  return results;
}

/** Komplett löschen */
export async function deleteReservation(reservationId: string) {
  const svc = createServiceClient();
  await svc.from("chat_reservations").delete().eq("id", reservationId);
  revalidatePath("/chatbot/reservations");
}
