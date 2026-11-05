import { NextResponse } from "next/server";
import { pairSalonDevice } from "@/lib/salon/auth";
import { verifyKopplungToken } from "@/lib/salon/kopplung-token";

// Öffentlich (middleware): QR aus /salon-admin/einnahmen → Gerät freischalten → Einnahmen-Erfassung
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!verifyKopplungToken(token)) {
    return new NextResponse("Link ungültig oder abgelaufen — bitte im Dashboard einen neuen QR-Code erzeugen.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  await pairSalonDevice();
  return NextResponse.redirect(new URL("/salon/einnahme", req.url));
}
