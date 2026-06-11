/**
 * Mail-Versand via Resend API.
 *
 * Setup:
 *   1. https://resend.com/signup — kostenloser Account (3000 Mails/Monat free)
 *   2. Domain verifizieren (DKIM/SPF Records bei Inwx hinterlegen)
 *      ODER: für schnellen Test 'onboarding@resend.dev' nutzen
 *   3. API-Key generieren, in Vercel-Env als RESEND_API_KEY
 *   4. RESEND_FROM_EMAIL (z.B. 'noreply@hairvenly.de' nach Domain-Verify)
 *
 * Diese Lib failt SOFT — wenn kein API-Key gesetzt, wird nur geloggt und
 * false zurückgegeben. So crasht der Cron nicht in der Setup-Phase.
 */

interface SendMailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(params: SendMailParams): Promise<{ ok: boolean; error?: string; id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  if (!apiKey) {
    console.warn("[mail] RESEND_API_KEY nicht gesetzt — Mail wird nicht versendet.", { to: params.to, subject: params.subject });
    return { ok: false, error: "RESEND_API_KEY fehlt" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[mail] Resend API Fehler", res.status, errText);
      return { ok: false, error: `Resend ${res.status}: ${errText}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
