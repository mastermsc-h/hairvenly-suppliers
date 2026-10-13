# FinTS-Worker (Sparkasse → Dashboard)

Holt die Kontoumsätze der Sparkasse Bremen per FinTS und schickt sie an
`/api/bank/ingest`. Das Dashboard gleicht Eingänge mit offenen
Shopify-Bestellungen ab (Tab **Finanzen → Zahlungseingänge**).

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

## Alltag

| Befehl | Wann |
|---|---|
| `fints status` | Zustand prüfen |
| `fints renew` | Wenn Dashboard/Mail „pushTAN-Freigabe nötig“ meldet (alle ~90–180 Tage) |
| `fints run` | Manueller Abruf ohne TAN |
| `fints install` / `fints uninstall` | Stündlichen Abruf an/aus |

Der automatische Lauf fordert **nie** selbst eine TAN an. Verlangt die
Sparkasse eine Freigabe, pausiert er, meldet das ans Dashboard (plus
Mitteilung am Mac und tägliche Mail) und wartet auf `fints renew`.

## Dateien

- Konfiguration, FinTS-Zustand, Log: `~/Library/Application Support/hairvenly-fints/`
  (`config.json` enthält die FinTS-Produkt-ID — gehört nicht ins öffentliche Repo)
- PIN: macOS-Schlüsselbund, nie auf der Platte oder im Log
- Ingest-Secret: `BANK_INGEST_SECRET` oder `SUPABASE_SERVICE_ROLE_KEY` aus `dashboard/.env.local`

## Technik

- Bank: Sparkasse Bremen, BLZ 29050101, `https://banking-hb6.s-fints-pt-hb.de/fints30`
- TAN-Verfahren: pushTAN 2.0 (923, decoupled)
- Abrufzeitraum: seit letztem Erfolg minus 3 Tage (max. 89 Tage, PSD2-Grenze ohne TAN)
- Doppelte Umsätze verwirft das Dashboard über einen Dedupe-Schlüssel
