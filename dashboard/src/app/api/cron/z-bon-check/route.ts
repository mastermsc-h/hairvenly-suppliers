import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { sendMail } from "@/lib/mail";
import { heuteBerlin, plusTage, wochentag, zbonLage } from "@/lib/z-bons/pruefung";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NAME = { shopify_pos: "Shopify POS", nexi: "Nexi (Treatwell)" } as const;
const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const de = (d: string) => `${WT[wochentag(d)]} ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

function gleich(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * Wöchentlicher Z-Bon-Check (montags): prüft die Vorwoche Mo–So und meldet zusätzlich
 * ältere, noch offene Tage der letzten 8 Wochen. Ergebnis → z_bon_pruefungen (Banner auf
 * /finances/z-bons) + Mail an das Finanz-Team, wenn etwas fehlt. ?dry=1 = ohne Speichern/Mail.
 * Auth: Bearer CRON_SECRET (Vercel-Cron) oder Bearer SUPABASE_SERVICE_ROLE_KEY (Wartung).
 */
export async function GET(req: NextRequest) {
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const secrets = [process.env.CRON_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean) as string[];
  if (!given || !secrets.some((s) => gleich(given, s))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const sb = createServiceClient();

  const heute = heuteBerlin();
  const bis = plusTage(heute, -(wochentag(heute) === 0 ? 7 : wochentag(heute))); // letzter Sonntag
  const von = plusTage(bis, -6); // Montag davor
  const lage = await zbonLage(sb, plusTage(von, -56), bis);
  const fehlend = lage.fehlend;
  const dieseWoche = fehlend.filter((f) => f.datum >= von);
  const aelter = fehlend.filter((f) => f.datum < von);

  let mailStatus = fehlend.length ? "nicht gesendet" : "nichts fehlt";
  if (fehlend.length && !dry) {
    const { data: empf } = await sb.from("profiles").select("email, denied_features").eq("is_admin", true).neq("role", "supplier");
    const emails = ((empf ?? []) as { email: string | null; denied_features: string[] | null }[])
      .filter((u) => u.email && !(u.denied_features ?? []).includes("finances"))
      .map((u) => u.email as string);
    const liste = (l: typeof fehlend) => `<ul>${l.map((f) => `<li>${de(f.datum)} — ${NAME[f.quelle]}</li>`).join("")}</ul>`;
    const html = `
      <p>Beim Wochencheck der Z-Bons (${de(von)} – ${de(bis)}) fehlen ${fehlend.length} Tagesabschlüsse.</p>
      ${dieseWoche.length ? `<p><b>Letzte Woche:</b></p>${liste(dieseWoche)}` : ""}
      ${aelter.length ? `<p><b>Noch offen aus den Wochen davor:</b></p>${liste(aelter)}` : ""}
      <p>Bitte abfotografieren und hochladen — oder den Tag als „kein Bon" markieren, wenn die Kasse zu war.</p>
      <p><a href="https://suppliers.hairvenly.de/finances/z-bons">Z-Bons im Dashboard</a></p>`;
    const mail = emails.length
      ? await sendMail({ to: emails, subject: `Z-Bons: ${fehlend.length} fehlen (Woche bis ${bis.slice(8, 10)}.${bis.slice(5, 7)}.)`, html })
      : { ok: false, error: "keine Empfänger" };
    mailStatus = mail.ok ? `gesendet an ${emails.length}` : `Mail fehlgeschlagen: ${mail.error ?? "?"}`;
  }

  if (!dry) {
    const { error } = await sb.from("z_bon_pruefungen").insert({ von, bis, fehlend, mail_status: mailStatus });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, von, bis, fehlend, mail: mailStatus, dry });
}
