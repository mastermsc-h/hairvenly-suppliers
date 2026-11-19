// Schlechte Bewertungen aus drei Quellen (server-only):
//  - Shop (Judge.me): öffentliche Widget-Schnittstelle, nach Sternen aufsteigend sortiert →
//    so lange blättern, bis 3 Sterne erreicht sind. Nur veröffentlichte Bewertungen.
//  - Google: Places API (New), braucht GOOGLE_PLACES_API_KEY + GOOGLE_PLACE_ID. Google liefert
//    nur Schnitt, Anzahl und höchstens 5 Bewertungen – schlechte werden nur unter diesen erkannt.
//  - Trustpilot: öffentliche TrustBox-Daten, braucht TRUSTPILOT_BUSINESS_UNIT_ID.
// Fehlt eine Verbindung, kommt { verbunden: false } zurück statt eines Fehlers.

const SHOP_DOMAIN = "339520-3.myshopify.com";
const SCHLECHT_MAX = 2; // 1–2 Sterne gelten als schlecht

export interface SchlechteBewertung {
  sterne: number;
  datum: string; // YYYY-MM-DD
  titel: string;
  text: string;
  produkt: string | null;
  beantwortet: boolean | null;
}

export interface BewertungsQuelle {
  verbunden: boolean;
  /** Alle Bewertungen der Quelle (soweit bekannt). */
  gesamt: number | null;
  schnitt: number | null;
  /** Schlechte Bewertungen insgesamt (Google: nur unter den sichtbaren). */
  schlechtGesamt: number | null;
  /** Schlechte Bewertungen der letzten 30 / 90 Tage. */
  schlecht30: number;
  schlecht90: number;
  /** Neueste schlechte zuerst. */
  liste: SchlechteBewertung[];
  hinweis?: string;
}

const leer = (hinweis: string): BewertungsQuelle => ({ verbunden: false, gesamt: null, schnitt: null, schlechtGesamt: null, schlecht30: 0, schlecht90: 0, liste: [], hinweis });

const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
function tageSeit(iso: string): number {
  return Math.round((Date.parse(`${berlin.format(new Date())}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 86_400_000);
}
function zaehle(liste: SchlechteBewertung[]) {
  return { schlecht30: liste.filter((b) => tageSeit(b.datum) <= 30).length, schlecht90: liste.filter((b) => tageSeit(b.datum) <= 90).length };
}
const ent = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

// ── Shop (Judge.me) ──────────────────────────────────────────────────────────
export async function ladeShopBewertungen(): Promise<BewertungsQuelle> {
  const liste: SchlechteBewertung[] = [];
  let gesamt: number | null = null;
  for (let seite = 1; seite <= 12; seite++) {
    const url = `https://api.judge.me/reviews/all_reviews_js_based?shop_domain=${SHOP_DOMAIN}&page=${seite}&per_page=25&review_type=all-reviews&sort_by=rating&sort_dir=asc`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Dashboard)" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Judge.me ${res.status}`);
    const d = (await res.json()) as { html?: string; number_of_shop_reviews?: number; number_of_product_reviews?: number };
    if (gesamt == null) gesamt = (Number(d.number_of_shop_reviews) || 0) + (Number(d.number_of_product_reviews) || 0);
    const teile = (d.html ?? "").split("<div class='jdgm-rev ").slice(1);
    if (!teile.length) break;
    let weiter = true;
    for (const t of teile) {
      const sterne = Number(t.match(/data-score='(\d)'/)?.[1] ?? 0);
      if (!sterne) continue;
      if (sterne > SCHLECHT_MAX) { weiter = false; break; }
      const zeit = t.match(/jdgm-rev__timestamp[^>]*data-content='([^']+)'/)?.[1] ?? "";
      const datum = zeit ? berlin.format(new Date(zeit.replace(" UTC", "Z").replace(" ", "T"))) : "";
      // Alles nach dem Antwort-Block ist nur noch schließendes HTML → Text dort = Antwort des Shops
      const antwort = t.split("jdgm-rev__reply'>")[1] ?? "";
      liste.push({
        sterne,
        datum,
        titel: ent(t.match(/class='jdgm-rev__title'>([\s\S]*?)<\/strong>/)?.[1] ?? ""),
        text: ent(t.match(/class='jdgm-rev__body'>([\s\S]*?)<\/div>/)?.[1] ?? "").slice(0, 220),
        produkt: ent(t.match(/class='jdgm-rev__prod-link'>([\s\S]*?)<\/a>/)?.[1] ?? "") || null,
        beantwortet: ent(antwort).length > 0,
      });
    }
    if (!weiter || teile.length < 25) break;
  }
  liste.sort((a, b) => b.datum.localeCompare(a.datum));
  return { verbunden: true, gesamt, schnitt: null, schlechtGesamt: liste.length, ...zaehle(liste), liste };
}

// ── Google (Places API New) ──────────────────────────────────────────────────
export async function ladeGoogleBewertungen(): Promise<BewertungsQuelle> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const place = process.env.GOOGLE_PLACE_ID;
  if (!key || !place) return leer("Google ist noch nicht verbunden (Places-API-Schlüssel und Place-ID fehlen).");
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(place)}?languageCode=de`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "rating,userRatingCount,reviews" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Google Places ${res.status}`);
  const d = (await res.json()) as {
    rating?: number; userRatingCount?: number;
    reviews?: Array<{ rating?: number; publishTime?: string; text?: { text?: string }; originalText?: { text?: string } }>;
  };
  const liste: SchlechteBewertung[] = (d.reviews ?? [])
    .filter((r) => (r.rating ?? 5) <= SCHLECHT_MAX)
    .map((r) => {
      const text = (r.originalText?.text ?? r.text?.text ?? "").trim();
      return { sterne: r.rating ?? 0, datum: r.publishTime ? berlin.format(new Date(r.publishTime)) : "", titel: text.slice(0, 70), text: text.slice(0, 220), produkt: null, beantwortet: null };
    })
    .sort((a, b) => b.datum.localeCompare(a.datum));
  return {
    verbunden: true, gesamt: d.userRatingCount ?? null, schnitt: d.rating ?? null, schlechtGesamt: null, ...zaehle(liste), liste,
    hinweis: "Google zeigt nur die 5 relevantesten Bewertungen – ältere schlechte können fehlen.",
  };
}

// ── Trustpilot (TrustBox-Daten) ──────────────────────────────────────────────
export async function ladeTrustpilotBewertungen(): Promise<BewertungsQuelle> {
  const bu = process.env.TRUSTPILOT_BUSINESS_UNIT_ID;
  if (!bu) return leer("Trustpilot ist noch nicht verbunden (Business-Unit-ID fehlt).");
  // Vorlage „Review Collector/List“: liefert Anzahl je Stern und die gefilterten Bewertungen
  const url = `https://widget.trustpilot.com/trustbox-data/539adbd6dec7e10e686debee?businessUnitId=${encodeURIComponent(bu)}&locale=de-DE&reviewLanguages=de&reviewStars=1,2&reviewsPerPage=50`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Dashboard)" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Trustpilot ${res.status}`);
  const d = (await res.json()) as {
    businessEntity?: { trustScore?: number; numberOfReviews?: { total?: number; oneStar?: number; twoStars?: number } };
    reviews?: Array<{ stars?: number; createdAt?: string; title?: string; text?: string; reply?: unknown }>;
  };
  const n = d.businessEntity?.numberOfReviews;
  const liste: SchlechteBewertung[] = (d.reviews ?? [])
    .filter((r) => (r.stars ?? 5) <= SCHLECHT_MAX)
    .map((r) => ({ sterne: r.stars ?? 0, datum: r.createdAt ? berlin.format(new Date(r.createdAt)) : "", titel: (r.title ?? "").slice(0, 90), text: (r.text ?? "").slice(0, 220), produkt: null, beantwortet: r.reply ? true : r.reply === null ? false : null }))
    .sort((a, b) => b.datum.localeCompare(a.datum));
  return {
    verbunden: true,
    gesamt: n?.total ?? null,
    schnitt: d.businessEntity?.trustScore ?? null,
    schlechtGesamt: n ? (n.oneStar ?? 0) + (n.twoStars ?? 0) : liste.length,
    ...zaehle(liste),
    liste,
  };
}
