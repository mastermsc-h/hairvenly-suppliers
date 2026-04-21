# Hairvenly Dashboard — Projekt-Kontext

## Tech Stack
- **Framework:** Next.js 16 + React 19 + TypeScript
- **Database:** Supabase (PostgreSQL + Auth + Storage + RLS)
- **Styling:** Tailwind CSS 4 (neutral color palette, rounded-2xl cards, shadow-sm)
- **Icons:** Lucide React
- **Charts:** Recharts
- **i18n:** Custom (de/en/tr) in src/lib/i18n.ts
- **Google APIs:** googleapis (Sheets export, import, Apps Script integration)

## Architektur
- Server Components (default) + Client Components ("use client") für Interaktivität
- Server Actions ("use server") mit FormData für Mutations
- Supabase RLS: Admins sehen alles, Suppliers nur eigene Daten
- Auth: requireProfile() / requireAdmin() Helpers

## Bestehende Features
- **Übersicht:** Dashboard mit KPIs, Bestellungen pro Lieferant
- **Bestellungen:** CRUD, Payments, Documents, Timeline
- **Neue Bestellung (Wizard):** Kaskadierte Dropdowns, Bestellvorschläge aus Sheets importieren, Budget-Generierung via Apps Script Web App, Google Sheets Export, PDF-Generierung
- **Produktkatalog:** Sync aus Shopify-Sheets + Bestell-Sheets, 3-fach Mapping (Hairvenly/Lieferant/Shopify), CRUD
- **Lieferanten:** CRUD, Banking, Avatar, Drag-to-reorder
- **Benutzer:** Registrierung, Approval, Multi-Language
- **Retouren:** Rücksendungen, Umtausch, Reklamationen — Shopify Returns/Refunds Sync, manuelle CRUD-Eingabe, Filterable Tabelle mit Typ/Status/Bearbeiter-Filtern, Analytics mit KPIs & Recharts (Trend, Gründe-Pie, Produkt-Bar, Bearbeiter-Workload)

## Datei-Konventionen
- Pages: `src/app/(app)/[bereich]/page.tsx`
- Client Components: `[bereich]/component-name.tsx` mit "use client"
- Server Actions: `src/lib/actions/[bereich].ts`
- Types: `src/lib/types.ts` (am Ende anhängen)
- i18n: `src/lib/i18n.ts` (Keys am Ende jeder Sprach-Sektion anhängen)
- Migrations: `supabase/migrations/NNNN_beschreibung.sql`

## UI Patterns
- Cards: `bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm`
- Primary Button: `bg-neutral-900 text-white font-medium rounded-lg px-4 py-2`
- Inputs: `rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900`
- Labels: `text-xs font-medium text-neutral-600 uppercase tracking-wide`
- Sidebar NavLink: `flex items-center gap-2 px-3 py-2 rounded-lg`

## Rollen & Berechtigungen
- **Admin**: Sieht alles, denied_features ignoriert
- **Mitarbeiter (employee)**: is_admin=true in DB (voller Datenzugriff), aber UI-Features einzeln steuerbar via denied_features
- **Lieferant (supplier)**: Nur eigene Bestellungen (RLS), minimale Sidebar
- Feature-Keys: prices, debt, suppliers, users, wizard, catalog, stock, charts, supplier_kg, finances, returns
- hasFeature(profile, key): Auth-Helper fuer Feature-Checks
- requireFeature(key): Server-Guard fuer Seiten

## Sidebar-Struktur (aktuelle Reihenfolge)
1. Übersicht (alle)
2. Bestellungen (alle)
3. Lieferanten (feature: suppliers)
4. Benutzer (nur admin)
5. --- Separator ---
6. Neue Bestellung (feature: wizard)
7. Produktkatalog (feature: catalog)
8. Preistabellen (feature: prices)
9. --- Separator ---
10. Produktlager (feature: stock)
11. --- Separator ---
12. Finanzen (feature: finances)
13. --- Separator ---
14. Retouren (feature: returns) — Übersicht + Analyse

## Lieferanten
- Amanda (6 Wochen Lieferzeit)
- Eyfel Ebru CN+TR (8 Wochen CN, 2 Wochen TR, regions: ["CN", "TR"])
- Aria (6 Wochen)

## Supabase
- URL: xzisnlkqiomvmbslwhvg.supabase.co
- Tabellen: suppliers, profiles, orders, payments, documents, order_events, orders_with_totals (view), product_methods, product_lengths, product_colors, order_items, returns, return_items, return_events, v_returns_summary, v_returns_by_reason, v_returns_by_product (views)

## Google Sheets Integration
- Amanda Bestell-Sheet: env GOOGLE_SHEET_AMANDA
- China Bestell-Sheet: env GOOGLE_SHEET_CHINA
- Stock Calculation: env GOOGLE_SHEET_STOCK
- Apps Script Web App: env GOOGLE_APPS_SCRIPT_URL (doPost mit {supplier, budgetG})
- Service Account: google-service-account.json (in .gitignore!)

## Geplante Features (Roadmap)
- **Produktlager:** Lagerbestand-Dashboard mit Shopify-Daten, Velocity, Topseller, Nullbestand-Alerts, Nachbestellpunkte — als neuer Sidebar-Punkt
- **WhatsApp-Benachrichtigungen:** Mitarbeiter benachrichtigen wenn Bestellungen fällig sind (via Twilio oder WhatsApp Business API)
- **Finanzen:** BWA-Analyse, EÜR, Schulden/Rücklagen-Übersicht, Steuerzahlungen
- **Shopify-Integration:** Live-Daten direkt aus Shopify statt über Sheets
- **Retouren-Management:** Rücksendungen, Umtausch, Reklamationen — Daten aus Shopify Returns/Refunds API + manuelle Anreicherung (Grund, Typ, Bearbeiter, Umtausch-Details, Reklamations-Lösung). KPIs: Rückgabequote, häufigste Gründe, Produkt-/Lieferanten-Analyse. DB: returns + return_items + return_events Tabellen

## Datenquellen für Lagerbestand
- **Shopify-Daten** stehen im Google Sheet "Stock calculation" (env GOOGLE_SHEET_STOCK)
  - Tab "Russisch - GLATT": Amanda-Produkte mit Lagerbestand, Unterwegs, Varianten
  - Tab "Usbekisch - WELLIG": Eyfel-Produkte mit Lagerbestand, Unterwegs, Varianten
  - Tab "Vorschlag - Amanda/China": Bestellvorschläge mit Velocity, Ziel, Bestellung
  - Tab "Topseller": Verkaufsstatistiken
  - Tab "Verkaufsanalyse": Detaillierte Verkaufsdaten
- **Apps Script** aktualisiert diese Daten aus Shopify (Funktion: refreshTopseller, createBestellungAmanda/China)

## Wichtige Regeln
- NIEMALS bestehende Features/Dateien ändern ohne explizite Anweisung
- Neue Features als NEUE Sidebar-Punkte unter einem Separator
- Immer i18n für alle 3 Sprachen (de/en/tr)
- Immer RLS Policies für neue Tabellen
- Migrationen als neue nummerierte Dateien (aktuell: 0013), nie bestehende ändern
- Bei neuen Sidebar-Bereichen: Separator-Gruppe verwenden
