import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runBankMatching } from "@/lib/bank/engine";
import { sendMail } from "@/lib/mail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Täglicher Sicherheitsnetz-Cron für den Zahlungsabgleich.
 *  1. Abgleich nachholen (falls ein Worker-Lauf mittendrin abgebrochen ist).
 *  2. Warn-Mail an Admins, wenn der FinTS-Worker eine TAN-Freigabe braucht
 *     oder seit >72h nichts geliefert hat — max. 1× pro 24h.
 * Auth wie die anderen Crons: Bearer CRON_SECRET (falls gesetzt).
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected && (request.headers.get("authorization") ?? "") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createServiceClient();
  let matching: unknown = null;
  try {
    matching = await runBankMatching();
  } catch (e) {
    matching = { error: e instanceof Error ? e.message : String(e) };
  }

  const { data: state } = await sb.from("bank_sync_state").select("*").eq("id", 1).maybeSingle();
  if (!state || !state.last_fetch_at) {
    // Worker noch nie gelaufen → nichts zu warnen (Setup noch nicht erfolgt).
    return NextResponse.json({ ok: true, matching, alert: "worker_never_ran" });
  }

  const now = Date.now();
  const lastSuccess = state.last_success_at ? new Date(state.last_success_at).getTime() : 0;
  const needsTan = state.last_fetch_code === "needs_tan";
  const authFailed = state.last_fetch_code === "auth_failed";
  // 72h statt 24h: der Worker läuft auf dem Mac — ein ausgeschaltetes
  // Wochenende soll keinen Fehlalarm auslösen. TAN-Bedarf meldet sofort.
  const stale = now - lastSuccess > 72 * 3600_000;
  const recentlyAlerted = state.last_alert_at && now - new Date(state.last_alert_at).getTime() < 23 * 3600_000;

  if (!(needsTan || authFailed || stale) || recentlyAlerted) {
    return NextResponse.json({ ok: true, matching, alert: null });
  }

  const { data: recipients } = await sb
    .from("profiles")
    .select("email, role, denied_features")
    .eq("is_admin", true)
    .neq("role", "supplier");
  const emails = ((recipients ?? []) as { email: string | null; denied_features: string[] | null }[])
    .filter((u) => u.email && !(u.denied_features ?? []).includes("finances"))
    .map((u) => u.email as string);

  const reason = authFailed
    ? "Die Sparkasse hat die Anmeldung abgelehnt (PIN oder Anmeldename). Der automatische Abruf ist gestoppt, damit der Zugang nicht gesperrt wird. Erst im Online-Banking anmelden, dann am Mac <code>fints setup</code> ausführen."
    : needsTan
    ? "Die Sparkasse verlangt eine neue pushTAN-Freigabe für den Umsatzabruf."
    : `Der Bank-Abruf hat seit ${state.last_success_at ? new Date(state.last_success_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) : "Beginn"} keine Umsätze geliefert${state.last_fetch_message ? ` (${state.last_fetch_message})` : ""}.`;
  const html = `
    <p>${reason}</p>
    <p>Solange das so ist, werden Vorkasse-Zahlungen nicht automatisch erkannt.</p>
    <p><b>Lösung:</b> Am Mac im Terminal ausführen und die Freigabe in der S-pushTAN-App bestätigen:</p>
    <pre>~/hairvenly-inventory/dashboard/scripts/fints-worker/fints renew</pre>
    <p><a href="https://suppliers.hairvenly.de/finances/payments">Zahlungseingänge im Dashboard</a></p>`;

  let mail: { ok: boolean; error?: string } = { ok: false, error: "keine Empfänger" };
  if (emails.length) mail = await sendMail({ to: emails, subject: "Bank-Abgleich: Aktion nötig", html });
  if (mail.ok) await sb.from("bank_sync_state").update({ last_alert_at: new Date().toISOString() }).eq("id", 1);

  return NextResponse.json({ ok: true, matching, alert: authFailed ? "auth_failed" : needsTan ? "needs_tan" : "stale", mail });
}
