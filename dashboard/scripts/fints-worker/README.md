# FinTS-Worker (Sparkasse + Targobank → Dashboard)

Holt die Kontoumsätze der Sparkasse Bremen und des Targobank-Gehaltskontos per
FinTS und schickt sie an `/api/bank/ingest`. Das Dashboard gleicht Eingänge mit
offenen Shopify-Bestellungen ab (**Finanzen → Zahlungseingänge**) und
kategorisiert alle Umsätze (**Finanzen → Kontoumsätze**). Jede Bank läuft
unabhängig — wartet eine auf eine TAN, liefert die andere weiter.

```
Sparkasse ──FinTS──▶ Mac (dieser Worker, launchd stündlich 7–21 Uhr)
                         │  HTTPS + Bearer-Secret
                         ▼
               suppliers.hairvenly.de/api/bank/ingest
                         │  Abgleich (off / shadow / live)
                         ▼
               Shopify: orderMarkAsPaid + Tag "Bank-Abgleich" + Notiz
```

## Einrichtung (einmalig)

```bash
~/hairvenly-inventory/dashboard/scripts/fints-worker/fints setup
```

Fragt den Online-Banking-Anmeldenamen und legt die PIN im
macOS-Schlüsselbund ab (Dienst `hairvenly-fints`). Danach einmal in der
S-pushTAN-App freigeben. Am Ende wird der stündliche Abruf aktiviert.

## Weitere Bank (Targobank)

```bash
~/hairvenly-inventory/dashboard/scripts/fints-worker/fints setup targobank
```

Gleicher Ablauf: Anmeldename/Kundennummer, PIN in den Schlüsselbund (eigener
Eintrag `hairvenly-fints-targobank`), Freigabe in der Banking-App. photoTAN/QR-
Grafiken öffnet der Worker als Bild; chipTAN mit Flickercode geht nicht.

## PayPal-Guthaben (optional)

```bash
~/hairvenly-inventory/dashboard/scripts/fints-worker/fints setup paypal
```

Liest nur das verfügbare EUR-Guthaben (`GET /v1/reporting/balances`) und schickt es mit
dem stündlichen Abruf ans Dashboard (Liquidität: zählt als verfügbares Geld). Vorher bei
developer.paypal.com → Apps & Credentials → **Live** eine App anlegen, unter Features
**„Transaction search“** aktivieren, Client-ID + Secret kopieren. Secret liegt im
Schlüsselbund (`hairvenly-fints-paypal`). PayPal meldet Salden mit bis zu 3 h Verzögerung.

## Alltag

| Befehl | Wann |
|---|---|
| `fints status` | Zustand aller Banken prüfen |
| `fints renew [bank]` | Wenn Dashboard/Mail „TAN-Freigabe nötig“ meldet (ohne Bank: alle, die warten) |
| `fints backfill [bank] [--since 2025-07-01]` | Historie holen (älter als 90 Tage → TAN nötig) |
| `fints run` | Manueller Abruf ohne TAN, alle Banken |
| `fints install` / `fints uninstall` | Stündlichen Abruf an/aus |

Der automatische Lauf wartet **nie** auf eine TAN. Läuft die Freigabe ab,
schickt die Bank beim nächsten Abruf von sich aus einmal eine Anfrage aufs
Handy – die bitte **ablehnen bzw. ignorieren**. Der Worker pausiert dann nur
diese Bank, meldet das ans Dashboard (plus Mitteilung am Mac und tägliche Mail)
und wartet auf `fints renew <bank>`, wo du die Freigabe bewusst bestätigst.

## Dateien

- Konfiguration, FinTS-Zustand, Log: `~/Library/Application Support/hairvenly-fints/`
  (`config.json` enthält die FinTS-Produkt-ID — gehört nicht ins öffentliche Repo)
- Sparkasse: `state.bin`, `status.json`; weitere Banken: `state-<bank>.bin`, `status-<bank>.json`
- PIN: macOS-Schlüsselbund, nie auf der Platte oder im Log
- Ingest-Secret: `BANK_INGEST_SECRET` oder `SUPABASE_SERVICE_ROLE_KEY` aus `dashboard/.env.local`

## Technik

- Sparkasse Bremen, BLZ 29050101, `https://banking-hb6.s-fints-pt-hb.de/fints30`
- Targobank, BLZ 30020900, `https://fints.targobank.de/travicretail_fints30pintanbroker/FinTs30PinTanHttpGate` (laut DK-Liste)
- TAN-Verfahren: Sparkasse pushTAN 2.0 (923, decoupled); andere Banken: App-Verfahren bevorzugt, sonst Auswahl
- Abrufzeitraum: seit letztem Erfolg minus 3 Tage (max. 89 Tage, PSD2-Grenze ohne TAN)
- Doppelte Umsätze verwirft das Dashboard über einen Dedupe-Schlüssel
