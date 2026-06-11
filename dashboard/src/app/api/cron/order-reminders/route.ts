import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "@/lib/mail";

/**
 * Cron-Endpoint: einmal täglich (Vercel Cron 12:00 Berlin / 10:00 UTC)
 *
 * Prüft pro Lieferant mit order_cycle_enabled=true ob ein neuer Bestell-
 * Zyklus fällig ist. Wenn ja → digest Mail an alle aktiven Admins/Mitarbeiter
 * (is_admin=true und role != 'supplier').
 *
 * Idempotenz: supplies.order_cycle_last_reminded wird auf today gesetzt nach
 * erfolgreichem Versand → kein erneuter Versand am selben Tag.
 *
 * Authorisierung: erwartet Header 'authorization: Bearer <CRON_SECRET>'.
 * Auf Vercel automatisch gesetzt wenn vercel.json Cron konfiguriert hat,
 * lokal optional über CRON_SECRET env.
 */
export const dynamic = "force-dynamic";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Berechnet das aktuelle Zyklus-Start-Datum: largest (start + k*interval) <= today. */
function currentCycleStart(startIso: string, intervalDays: number, todayDate: Date): Date {
  const start = new Date(startIso + "T00:00:00Z");
  const diffDays = Math.floor((todayDate.getTime() - start.getTime()) / 86400000);
  if (diffDays < 0) return start; // start in der Zukunft
  const k = Math.floor(diffDays / intervalDays);
  const result = new Date(start);
  result.setUTCDate(result.getUTCDate() + k * intervalDays);
  return result;
}

function fmtDe(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

export async function GET(request: Request) {
  // Auth
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = todayIso();

  // Aktive Lieferanten mit Reminder
  const { data: suppliers, error: sErr } = await supabase
    .from("suppliers")
    .select("id, name, order_cycle_start_date, order_cycle_interval_days, order_cycle_last_reminded")
    .eq("order_cycle_enabled", true)
    .not("order_cycle_start_date", "is", null);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  type DueSupplier = {
    id: string;
    name: string;
    cycle_start: Date;
    last_order_at: string | null;
    days_overdue: number;
  };
  const due: DueSupplier[] = [];

  for (const sup of suppliers ?? []) {
    if (!sup.order_cycle_start_date) continue;
    const cycle = currentCycleStart(
      String(sup.order_cycle_start_date),
      sup.order_cycle_interval_days || 14,
      today,
    );
    // Kein Reminder wenn aktueller Zyklus noch in der Zukunft startet
    if (cycle.getTime() > today.getTime()) continue;

    // Letzte Bestellung beim Lieferant
    const { data: lastOrder } = await supabase
      .from("orders")
      .select("created_at")
      .eq("supplier_id", sup.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastDate = lastOrder?.created_at ? new Date(lastOrder.created_at) : null;
    // Wenn nach Zyklus-Start schon eine Bestellung angelegt wurde → erledigt
    if (lastDate && lastDate.getTime() >= cycle.getTime()) continue;

    // Tagesschutz: wenn heute schon erinnert wurde → skip
    if (sup.order_cycle_last_reminded === todayStr) continue;

    const daysOverdue = Math.floor((today.getTime() - cycle.getTime()) / 86400000);
    due.push({
      id: sup.id,
      name: sup.name,
      cycle_start: cycle,
      last_order_at: lastOrder?.created_at ?? null,
      days_overdue: daysOverdue,
    });
  }

  if (due.length === 0) {
    return NextResponse.json({ ok: true, checked: suppliers?.length ?? 0, due: 0 });
  }

  // Empfänger: alle Admins / MA mit Bestell-Recht (is_admin und nicht supplier)
  const { data: recipients } = await supabase
    .from("profiles")
    .select("email, full_name, role, denied_features")
    .eq("is_admin", true)
    .neq("role", "supplier");
  type Recipient = { email: string | null; full_name: string | null; role: string; denied_features: string[] | null };
  const emails = ((recipients ?? []) as Recipient[])
    .filter((u) => u.email && !(u.denied_features ?? []).includes("wizard"))
    .map((u) => u.email as string);

  if (emails.length === 0) {
    return NextResponse.json({ ok: true, due: due.length, sent: 0, reason: "Keine Empfänger" });
  }

  // Build mail
  const dashboardBase = process.env.NEXT_PUBLIC_SITE_URL || "https://suppliers.hairvenly.de";
  const subject = due.length === 1
    ? `Neue Bestellung fällig: ${due[0].name}`
    : `${due.length} Bestellungen fällig`;
  const rows = due.map((d) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">
        <strong style="color:#111;">${d.name}</strong><br>
        <span style="color:#888;font-size:12px;">Zyklus-Start: ${fmtDe(d.cycle_start)} · ${d.days_overdue === 0 ? "heute fällig" : `${d.days_overdue} Tag${d.days_overdue === 1 ? "" : "e"} überfällig`}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;font-size:13px;">
        ${d.last_order_at ? `Letzte Bestellung:<br>${new Date(d.last_order_at).toLocaleDateString("de-DE")}` : "Noch keine Bestellung"}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">
        <a href="${dashboardBase}/orders/new?supplier_id=${d.id}" style="background:#171717;color:#fff;text-decoration:none;padding:6px 12px;border-radius:6px;font-size:13px;display:inline-block;">Bestellung anlegen</a>
      </td>
    </tr>`).join("");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;">
      <h2 style="margin:0 0 16px;">Bestell-Erinnerung Hairvenly</h2>
      <p style="color:#444;line-height:1.5;">
        Es ${due.length === 1 ? "ist eine neue Auslandsbestellung" : `sind ${due.length} neue Auslandsbestellungen`} fällig:
      </p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">${rows}</table>
      <p style="color:#888;font-size:12px;margin-top:24px;line-height:1.5;">
        Diese Mail wird täglich versendet bis die jeweilige Bestellung angelegt wurde.
        Konfiguration über Lieferanten-Verwaltung im Dashboard.
      </p>
    </div>`;

  const mailRes = await sendMail({ to: emails, subject, html });

  // Last-reminded Tagesstempel setzen (auch bei mail-Fehler, damit kein Spam)
  if (mailRes.ok) {
    const dueIds = due.map((d) => d.id);
    await supabase
      .from("suppliers")
      .update({ order_cycle_last_reminded: todayStr })
      .in("id", dueIds);
  }

  return NextResponse.json({
    ok: mailRes.ok,
    error: mailRes.error,
    due: due.length,
    recipients: emails.length,
    suppliers: due.map((d) => ({ name: d.name, days_overdue: d.days_overdue })),
  });
}
