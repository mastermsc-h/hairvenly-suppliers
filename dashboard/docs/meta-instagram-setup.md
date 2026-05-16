# Meta / Instagram Setup — Schritt für Schritt

## Was wir wollen

Instagram-DMs landen automatisch in unserer Inbox (`/chatbot/inbox`).
Mitarbeiter sieht sie live, kann übernehmen, Bot kann optional antworten.

## Status

- ✅ Webhook-Endpoint: `/api/webhooks/meta` (deployed)
- ✅ Send-Funktionen für IG + WA implementiert
- ⚠️ ENV-Variablen müssen in Vercel gesetzt werden
- ⚠️ Meta Developer App muss erstellt werden
- ⚠️ App Review für Production-Zugriff (kann parallel laufen)

## Test Mode (sofort nutzbar)

Im "Test Mode" funktioniert der Webhook für **bis zu 5 Test-User** ohne App Review.
Perfekt um direkt mit deinem eigenen IG-Account zu starten.

### Schritt 1 — Meta Business Manager
1. [business.facebook.com](https://business.facebook.com) → einloggen
2. Stelle sicher dass dein Instagram-Account als **Business Account** verbunden ist
3. Falls noch nicht: bei IG → Settings → Account → Switch to Professional Account → Business

### Schritt 2 — Facebook Page
Instagram Business Account muss mit einer **Facebook Page** verknüpft sein.
1. Falls noch keine Page: erstelle eine (kann eine Mini-Page sein, muss nicht aktiv genutzt werden)
2. Bei IG → Settings → Account → Linked Accounts → Facebook Page verknüpfen

### Schritt 3 — Meta Developer App
1. [developers.facebook.com](https://developers.facebook.com) → My Apps → Create App
2. App Type: **Business**
3. App Name: z.B. "Hairvenly Chatbot"
4. Business Account: dein Hairvenly Business Manager
5. Create App

### Schritt 4 — Products hinzufügen
In der neuen App → "Add Product":
- **Instagram** → Set Up
- **WhatsApp** → Set Up (falls auch WA gewünscht)

### Schritt 5 — Instagram Messaging API konfigurieren
Im Instagram-Product:
1. **Instagram Account verknüpfen** — wähle dein Hairvenly Business-Konto
2. **Webhook-URL** eintragen:
   ```
   https://suppliers.hairvenly.de/api/webhooks/meta
   ```
3. **Verify Token** wählen (frei wählbar, z.B. `hairvenly_secret_2026`)
4. **Subscribe to fields**: `messages`, `messaging_postbacks`, `messaging_seen`

### Schritt 6 — Tokens generieren
In **Tools → Access Token Tool** (oder Graph API Explorer):
1. **Page Access Token** generieren (für Page+IG kombiniert)
2. Long-Lived machen (60 Tage gültig, dann erneuern):
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token?
     grant_type=fb_exchange_token&
     client_id={APP_ID}&
     client_secret={APP_SECRET}&
     fb_exchange_token={SHORT_LIVED_TOKEN}
   ```
3. Token speichern

### Schritt 7 — Instagram User ID rausfinden
```
GET https://graph.facebook.com/v21.0/me/accounts?access_token={TOKEN}
→ findet deine Facebook Pages
GET https://graph.facebook.com/v21.0/{PAGE_ID}?fields=instagram_business_account&access_token={TOKEN}
→ liefert Instagram User ID
```

### Schritt 8 — ENV-Variablen in Vercel setzen

Vercel-Dashboard → Settings → Environment Variables:

| Variable | Wert |
|---|---|
| `META_VERIFY_TOKEN` | (was du in Schritt 5 gewählt hast, z.B. `hairvenly_secret_2026`) |
| `META_PAGE_ACCESS_TOKEN` | Long-Lived Token aus Schritt 6 |
| `META_INSTAGRAM_USER_ID` | Instagram User ID aus Schritt 7 |
| `META_APP_SECRET` | App Secret (Settings → Basic in Developer App) |
| `WHATSAPP_PHONE_NUMBER_ID` | (nur für WhatsApp, optional) |

Nach dem Setzen: Vercel → Deployments → letztes → **Redeploy**

### Schritt 9 — Test-User hinzufügen
Im Test Mode: Roles → Test Users → Add Instagram Test User
Füge **dein eigenes IG-Account** hinzu.
Akzeptiere die Test-Einladung im Instagram.

### Schritt 10 — Erster Test
1. Sende eine Test-DM von deinem privaten IG an dein Business-IG
2. Schaue in `/chatbot/inbox` — die Nachricht sollte erscheinen
3. Falls ja: 🎉 funktioniert

### Schritt 11 — App Review (Production)
Damit auch Nicht-Test-User schreiben können:
1. App Review → Add Permissions:
   - `instagram_basic`
   - `instagram_manage_messages`
   - `pages_messaging`
   - `pages_show_list`
2. Use Case beschreiben + Demo-Video aufnehmen
3. Submission absenden — Review dauert 5-15 Werktage

## Troubleshooting

**Webhook-Verification schlägt fehl?**
- META_VERIFY_TOKEN in Vercel muss EXAKT mit dem in der Meta-App übereinstimmen
- Nach Setzen: Redeploy nicht vergessen

**Signature-Verification schlägt fehl?**
- META_APP_SECRET muss aus Settings → Basic → App Secret (nicht App ID!) sein

**Test-User-DMs kommen nicht an?**
- In Meta-App: "Webhooks" → Instagram → bestätigen dass `messages` field subscribed ist
- Check Vercel-Logs für Fehlermeldungen
