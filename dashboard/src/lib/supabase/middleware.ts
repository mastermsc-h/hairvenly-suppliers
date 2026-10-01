import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refresh session if expired.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/register");
  // /api/qr ist public — wird vom Shopify-Lieferschein-Renderer aufgerufen,
  // der keine Login-Cookies hat. Reine QR-Generierung, keine sensiblen Daten.
  const isPublic =
    isAuthRoute ||
    path.startsWith("/pending") ||
    path.startsWith("/_next") ||
    path.startsWith("/api/qr") ||  // covers /api/qr und /api/qr/[order]
    path.startsWith("/api/chat") ||  // chatbot endpoint — anonyme Kunden-Chats (POST + GET messages)
    path.startsWith("/api/debug-") ||  // temp debug
    path.startsWith("/api/webhooks/") ||  // shopify ruft webhooks ohne login auf
    path === "/api/pack/cleanup" ||  // vercel cron job (mit eigenem secret)
    // Vercel-Cron-Jobs haben keine Login-Cookies — jede Route unter /api/cron/
    // schützt sich selbst per CRON_SECRET-Header-Guard. Ohne diese Ausnahme
    // wurden order-reminders/refresh/fix-addresses zur Login-Seite redirected
    // und liefen still ins Leere (Bug gefunden 30.09.2026).
    path.startsWith("/api/cron/") ||
    // Foto-Handoff iMac → iPhone: /pack-foto/<token> ist öffentlich, der Zugriff
    // wird durch den signierten, 2h gültigen Session-Token geschützt (kein
    // Login am Handy nötig). Nur Foto-Upload möglich, keine Bestelldaten.
    path.startsWith("/pack-foto/") ||
    path === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (user && (path.startsWith("/login") || path.startsWith("/register"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
