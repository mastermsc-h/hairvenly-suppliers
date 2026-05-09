// Cookie-basierte "Light"-Auth fuer das Salon-iPad.
// Kein Supabase-Auth — der iPad ist im Guided-Access-Mode dauerhaft auf
// /salon. Mitarbeiter-Identitaet wird ueber PIN bei jeder Entnahme erfasst.
//
// Wir setzen ein Cookie 'salon_device' = '1' beim ersten Geraete-Pairing,
// damit nicht jeder beliebige Browser zugreifen kann. Pairing erfolgt
// einmalig durch den Admin im Manager-Dashboard.

import { cookies } from "next/headers";

const COOKIE_NAME = "salon_device";
const COOKIE_VALUE = "paired";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 Jahr

export async function isSalonDevicePaired(): Promise<boolean> {
  const c = await cookies();
  return c.get(COOKIE_NAME)?.value === COOKIE_VALUE;
}

export async function pairSalonDevice(): Promise<void> {
  const c = await cookies();
  c.set(COOKIE_NAME, COOKIE_VALUE, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function unpairSalonDevice(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}
