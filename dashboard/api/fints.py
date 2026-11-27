"""
Bank-Abruf in der Cloud (Vercel-Python-Funktion) — Gegenstück zum Mac-Worker
scripts/fints-worker/fints_worker.py, damit der Abruf rund um die Uhr läuft,
auch wenn der Laptop aus ist. Die Bank-Logik (Verbindung, Dialog, Umsätze,
Salden, TAN-Regeln) ist bewusst 1:1 vom Mac-Worker übernommen.

Aufrufe (alle mit "Authorization: Bearer <CRON_SECRET>"):
  GET  /api/fints                       stündlicher Cron: alle Banken OHNE TAN
  POST /api/fints {"action":"renew","bank":"sparkasse"}
                                        Freigabe erneuern: Bank schickt eine pushTAN,
                                        die Funktion wartet bis ~4 Min. auf die
                                        Bestätigung in der Banking-App (aufgerufen vom
                                        Dashboard-Knopf über /api/bank/fints-renew)

Geheimnisse (Vercel-Umgebungsvariablen, nie im Repo, nie im Log):
  FINTS_PRODUCT_ID, FINTS_<BANK>_USER, FINTS_<BANK>_PIN, PAYPAL_CLIENT_ID, PAYPAL_SECRET
Zustand je Bank (System-ID, BPD/UPD, TAN-Verfahren — keine PIN) + Status:
  Supabase-Tabelle bank_fints_cloud (nur Service-Role).

Sicherheitsregeln wie am Mac:
  - Der Cron wartet NIE auf eine TAN. Verlangt die Bank eine, wird needs_tan
    gesetzt und die Bank bis zum Erneuern-Knopf nicht mehr kontaktiert
    (sonst käme jede Stunde eine pushTAN aufs Handy).
  - Lehnt die Bank die Anmeldung ab (PIN/Anmeldename), wird auth_failed gesetzt
    und NIE automatisch erneut versucht (nach 3 Fehlversuchen sperrt die Bank).
  - Notschalter: Umgebungsvariable FINTS_CLOUD=off → Cron tut nichts.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

PRODUCT_VERSION = "1.0"
DASHBOARD_URL = os.environ.get("FINTS_DASHBOARD_URL", "https://suppliers.hairvenly.de").rstrip("/")
PAYPAL_API = "https://api-m.paypal.com"
OVERLAP_DAYS = 3
INITIAL_DAYS = 89
# Vercel-Limit der Funktion: 300 s (vercel.json). Freigabe-Warten endet vorher.
RENEW_WAIT_S = 230
LOCK_S = 290

BANKS = [
    {"key": "sparkasse", "name": "Sparkasse", "blz": "29050101",
     "server": "https://banking-hb6.s-fints-pt-hb.de/fints30"},
    {"key": "targobank", "name": "Targobank", "blz": "30020900",
     "server": "https://fints.targobank.de/travicretail_fints30pintanbroker/FinTs30PinTanHttpGate"},
]

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("fints-cloud")
# python-fints loggt Nachrichteninhalte nur auf DEBUG — nie aktivieren.
logging.getLogger("fints").setLevel(logging.WARNING)

AUTH_CODES = {"9340", "9910", "9930", "9931", "9941", "9942", "9943", "9944", "9945", "9946", "9947", "9948", "9951"}
AUTH_WORDS = ("pin", "kennung", "anmelde", "gesperrt", "legitimation", "zugang", "benutzer")


class BankResponses:
    """Rückmeldungen der Bank (Code + Text), wie im Mac-Worker."""

    def __init__(self) -> None:
        self.items: list[tuple[str, str]] = []

    def add(self, code: str, text: str) -> None:
        item = (str(code), str(text or "").strip())
        if item not in self.items:
            self.items.append(item)
            if item[0][:1] in ("3", "9"):
                log.warning("Bank %s %s", *item)

    def errors(self) -> list[tuple[str, str]]:
        return [(c, t) for c, t in self.items if c.startswith("9")]

    def auth_failed(self) -> bool:
        codes = {c for c, _ in self.items}
        if "3938" in codes or {"9050", "9010"} <= codes:
            return True
        return any(c in AUTH_CODES or any(w in t.lower() for w in AUTH_WORDS) for c, t in self.errors())

    def summary(self) -> str:
        errs = self.errors() or [(c, t) for c, t in self.items if c.startswith("3")]
        return "; ".join(f"{c} {t}".strip() for c, t in errs[:4])


class NeedsTan(Exception):
    pass


class TanTimeout(RuntimeError):
    pass


# ── Supabase (REST, Service-Role) ────────────────────────────────────────────

def _sb(method: str, path: str, body: object | None = None, prefer: str | None = None):
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else None


def load_row(bank: str) -> dict:
    rows = _sb("GET", f"bank_fints_cloud?bank=eq.{urllib.parse.quote(bank)}&select=*") or []
    row = rows[0] if rows else {"bank": bank, "state_b64": None, "status": {}}
    row["status"] = row.get("status") or {}
    return row


def save_row(bank: str, state_b64: str | None = None, status: dict | None = None) -> None:
    body: dict = {"bank": bank, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()}
    if state_b64 is not None:
        body["state_b64"] = state_b64
    if status is not None:
        body["status"] = status
    _sb("POST", "bank_fints_cloud?on_conflict=bank", body, prefer="resolution=merge-duplicates,return=minimal")


def update_status(bank: str, **changes) -> dict:
    st = load_row(bank)["status"]
    st.update(changes)
    save_row(bank, status=st)
    return st


# ── Dashboard ────────────────────────────────────────────────────────────────

def post_dashboard(payload: dict) -> dict | None:
    secret = os.environ.get("BANK_INGEST_SECRET") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    req = urllib.request.Request(
        DASHBOARD_URL + "/api/bank/ingest", data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        log.error("Dashboard antwortet %s: %s", e.code, e.read().decode("utf-8", "replace")[:300])
    except Exception as e:
        log.error("Dashboard nicht erreichbar: %s", e)
    return None


def send(rows: list[dict], status: dict, balances: list[dict]) -> dict | None:
    """Umsätze + Salden + Status ans Dashboard, dann Abgleich zu Ende bringen (wie Mac-Worker)."""
    res = post_dashboard({"status": status, "transactions": rows, "balances": balances})
    if res is None:
        return None
    m = dict(res.get("matching") or {})
    k = dict(m.get("kategorien") or {})
    for _ in range(6):
        if not m.get("remaining") and not k.get("remaining"):
            break
        more = post_dashboard({"action": "match"})
        mm = (more or {}).get("matching") or {}
        kk = mm.get("kategorien") or {}
        if not more or (not mm.get("processed") and not kk.get("geprueft")):
            break
        m["remaining"] = mm.get("remaining", 0)
        k["remaining"] = kk.get("remaining", 0)
    log.info("Dashboard: %s neu von %s", res.get("inserted"), res.get("received"))
    return res


# ── Umsätze → Dashboard-Format (1:1 Mac-Worker) ──────────────────────────────

def _s(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


IBAN_LENGTHS = {
    "DE": 22, "AT": 20, "CH": 21, "LI": 21, "NL": 18, "BE": 16, "LU": 20, "FR": 27, "IT": 27, "ES": 24,
    "PT": 25, "PL": 28, "CZ": 24, "SK": 24, "HU": 28, "SI": 19, "HR": 21, "RO": 24, "BG": 22, "GR": 27,
    "DK": 18, "SE": 24, "NO": 15, "FI": 18, "EE": 20, "LV": 21, "LT": 20, "IE": 22, "GB": 22, "CY": 28,
    "MT": 31, "TR": 26, "MC": 27,
}


def split_iban_name(raw: str | None, iban: str | None) -> tuple[str | None, str | None]:
    if not raw or iban:
        return raw, iban
    s = raw.strip()
    n = IBAN_LENGTHS.get(s[:2].upper())
    if n and len(s) >= n and s[2:4].isdigit() and s[:n].isalnum():
        return (s[n:].strip() or None), s[:n].upper()
    i = 0
    while i < len(s) and s[i].isdigit():
        i += 1
    if 5 <= i <= 12:
        return (s[i:].strip() or None), None
    return s, None


def map_transaction(t, account_iban: str | None) -> dict | None:
    d = t.data
    amount = d.get("amount")
    date = d.get("date")
    if amount is None or date is None:
        return None
    entry = d.get("entry_date")
    value = getattr(amount, "amount", amount)
    currency = getattr(amount, "currency", None) or d.get("currency") or "EUR"
    purpose = _s(d.get("purpose"))
    extra = _s(d.get("additional_purpose"))
    if extra:
        purpose = f"{purpose} {extra}" if purpose else extra
    e2e = _s(d.get("end_to_end_reference"))
    if e2e and e2e.upper() == "NOTPROVIDED":
        e2e = None
    name, iban = split_iban_name(_s(d.get("applicant_name")), _s(d.get("applicant_iban")))
    booking = entry or date
    return {
        "booking_date": booking.isoformat()[:10], "value_date": date.isoformat()[:10],
        "amount": float(value), "currency": str(currency),
        "counterparty_name": name, "counterparty_iban": iban, "purpose": purpose,
        "posting_text": _s(d.get("posting_text")), "end_to_end_ref": e2e, "account_iban": account_iban,
    }


# ── FinTS (1:1 Mac-Worker, ohne Terminal-Eingaben) ───────────────────────────

def make_connection(url: str):
    """Connection: close + Resend derselben Bytes bei Verbindungsfehlern (Sparkasse
    schließt Keep-Alive nach wenigen Sekunden, gemessen 15.10.2026)."""
    import requests
    from fints.connection import FinTSHTTPSConnection
    from fints.exceptions import FinTSConnectionError

    class TimeoutSession(requests.Session):
        def request(self, *args, **kwargs):
            kwargs.setdefault("timeout", 60)
            return super().request(*args, **kwargs)

    class Connection(FinTSHTTPSConnection):
        def __init__(self, u):
            super().__init__(u)
            self._fresh()

        def _fresh(self):
            self.session = TimeoutSession()
            self.session.headers["Connection"] = "close"

        def send(self, msg):
            for attempt in range(3):
                try:
                    return super().send(msg)
                except FinTSConnectionError as e:
                    if attempt == 2 or not isinstance(e.__cause__, requests.ConnectionError):
                        raise
                    log.warning("Verbindung zur Bank abgebrochen (%s) – sende erneut (%d/2)", type(e.__cause__).__name__, attempt + 1)
                    time.sleep(2)
                    self._fresh()

    return Connection(url)


def bank_env(p: dict, suffix: str) -> str:
    return (os.environ.get(f"FINTS_{p['key'].upper()}_{suffix}") or "").strip()


def configured(p: dict) -> bool:
    return bool(os.environ.get("FINTS_PRODUCT_ID") and bank_env(p, "USER") and bank_env(p, "PIN"))


def make_client(p: dict, state: bytes | None, responses: BankResponses):
    from fints.client import FinTS3PinTanClient

    class Client(FinTS3PinTanClient):
        def _process_response(self, dialog, segment, response):
            responses.add(response.code, response.text)
            return super()._process_response(dialog, segment, response)

    client = Client(
        p["blz"], bank_env(p, "USER"), bank_env(p, "PIN"), p["server"],
        product_id=os.environ["FINTS_PRODUCT_ID"], product_version=PRODUCT_VERSION, from_data=state,
    )
    client.connection = make_connection(p["server"])
    return client


def resolve_tan(client, res, wait_until: float | None):
    """wait_until=None → Cron: nie warten (NeedsTan). Sonst pushTAN-Bestätigung abwarten."""
    from fints.client import NeedTANResponse
    if not isinstance(res, NeedTANResponse):
        return res
    if wait_until is None:
        raise NeedsTan()
    while isinstance(res, NeedTANResponse):
        if not res.decoupled:
            raise RuntimeError("Die Bank verlangt eine TAN-Eingabe statt App-Freigabe — das geht nur am Mac (fints renew).")
        log.info("Warte auf Freigabe in der Banking-App …")
        while isinstance(res, NeedTANResponse) and time.time() < wait_until:
            time.sleep(3)
            res = client.send_tan(res, "")
        if isinstance(res, NeedTANResponse):
            raise TanTimeout("Freigabe nicht rechtzeitig in der Banking-App bestätigt.")
    return res


def choose_tan(client, p: dict) -> None:
    """Erstes Mal ohne gespeicherten Zustand: App-Freigabe (pushTAN/decoupled) wählen."""
    client.fetch_tan_mechanisms()
    mech = client.get_tan_mechanisms()
    candidates = [k for k in mech if k != "999"]
    pick = next((k for k in candidates if "push" in (mech[k].name or "").lower()), None) \
        or next((k for k in candidates if any(w in (mech[k].name or "").lower() for w in ("app", "secure", "decoupled"))), None) \
        or (candidates[0] if candidates else None)
    if pick:
        client.set_tan_mechanism(pick)
    if client.selected_tan_medium is None and client.is_tan_media_required():
        if p["key"] == "sparkasse":
            client.selected_tan_medium = ""  # kein get_tan_media() bei der Sparkasse (siehe Mac-Worker)
            return
        try:
            media = list(client.get_tan_media()[1] or [])
        except Exception as e:
            log.warning("%s: TAN-Medien nicht abrufbar (%s)", p["name"], e)
            media = []
        if media:
            client.set_tan_medium(media[0])
        else:
            client.selected_tan_medium = ""


def fetch_balances(client, p: dict, accounts: list) -> list[dict]:
    from fints.client import NeedTANResponse
    out: list[dict] = []
    for acc in accounts:
        try:
            bal = client.get_balance(acc)
        except Exception as e:
            log.warning("%s …%s: Kontostand nicht abrufbar (%s)", p["name"], acc.iban[-4:], e)
            break
        if isinstance(bal, NeedTANResponse) or bal is None:
            break
        try:
            amount = getattr(bal.amount, "amount", bal.amount)
            out.append({"account_iban": acc.iban, "saldo": float(amount), "stand": bal.date.isoformat()[:10]})
        except Exception as e:
            log.warning("%s …%s: Kontostand unlesbar (%s)", p["name"], acc.iban[-4:], e)
    return out


def fetch(p: dict, row: dict, responses: BankResponses, wait_until: float | None) -> tuple[list[dict], list[dict]]:
    state = base64.b64decode(row["state_b64"]) if row.get("state_b64") else None
    client = make_client(p, state, responses)
    if not client.get_current_tan_mechanism():
        if wait_until is None:
            raise NeedsTan()  # Ohne gespeicherten Zugang nur über den Erneuern-Knopf
        choose_tan(client, p)

    st = row["status"]
    today = dt.date.today()
    if st.get("last_success_date"):
        last = dt.date.fromisoformat(st["last_success_date"])
        start = max(today - dt.timedelta(days=INITIAL_DAYS), last - dt.timedelta(days=OVERLAP_DAYS))
    else:
        start = today - dt.timedelta(days=INITIAL_DAYS)
    ibans = [i for i in (st.get("account_ibans") or []) if i]

    rows: list[dict] = []
    balances: list[dict] = []
    umsaetze_fertig = False
    try:
        with client:
            if client.init_tan_response:
                resolve_tan(client, client.init_tan_response, wait_until)
            accounts = list(resolve_tan(client, client.get_sepa_accounts(), wait_until))
            chosen = [a for a in accounts if a.iban in ibans] if ibans else accounts
            if ibans and not chosen:
                log.warning("%s: konfigurierte IBANs nicht im Zugang gefunden", p["name"])
            for acc in chosen:
                res = resolve_tan(client, client.get_transactions(acc, start, today), wait_until)
                mapped = [m for m in (map_transaction(t, acc.iban) for t in (res or [])) if m]
                log.info("%s …%s: %d Umsätze seit %s", p["name"], acc.iban[-4:], len(mapped), start.isoformat())
                rows.extend(mapped)
            umsaetze_fertig = True
            balances = fetch_balances(client, p, chosen)
    except Exception as e:
        if umsaetze_fertig and not any(isinstance(x, (NeedsTan, TanTimeout)) for x in (e, e.__context__)):
            log.warning("%s: Fehler nach dem Umsatzabruf ignoriert (%s: %s)", p["name"], type(e).__name__, e)
            return rows, balances
        if isinstance(e, NeedsTan) or isinstance(e.__context__, NeedsTan):
            raise NeedsTan() from None
        if isinstance(e, TanTimeout) or isinstance(e.__context__, TanTimeout):
            raise TanTimeout("Freigabe nicht rechtzeitig in der Banking-App bestätigt.") from None
        raise
    finally:
        # Zustand (System-ID, BPD/UPD) immer sichern — sonst gilt Vercel beim
        # nächsten Lauf als neues Gerät und die Bank verlangt eine TAN.
        try:
            save_row(p["key"], state_b64=base64.b64encode(client.deconstruct(including_private=True)).decode())
        except Exception as e:
            log.warning("Zustand nicht gespeichert: %s", e)
    return rows, balances


def paypal_balance() -> dict | None:
    client_id = os.environ.get("PAYPAL_CLIENT_ID")
    secret = os.environ.get("PAYPAL_SECRET")
    if not client_id or not secret:
        return None
    try:
        auth = base64.b64encode(f"{client_id}:{secret}".encode()).decode()
        req = urllib.request.Request(
            PAYPAL_API + "/v1/oauth2/token", data=b"grant_type=client_credentials", method="POST",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            token = json.loads(resp.read().decode())["access_token"]
        req = urllib.request.Request(
            PAYPAL_API + "/v1/reporting/balances?currency_code=EUR",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        log.warning("PayPal nicht abrufbar: %s", e)
        return None
    eur = next((b for b in data.get("balances", []) if b.get("currency") == "EUR"), None)
    betrag = ((eur or {}).get("available_balance") or (eur or {}).get("total_balance") or {}).get("value")
    if betrag is None:
        return None
    return {"account_iban": "PAYPAL", "saldo": float(betrag), "stand": str(data.get("as_of_time") or dt.date.today().isoformat())[:10]}


def fetch_error(p: dict, e: Exception, responses: BankResponses) -> tuple[str, str]:
    bank = responses.summary()
    msg = (f"Bank: {bank}" if bank else f"{type(e).__name__}: {e}")[:300]
    code = "auth_failed" if responses.auth_failed() else "error"
    changes = {"last_error": msg}
    if code == "auth_failed":
        changes["auth_failed"] = True
    update_status(p["key"], **changes)
    return code, msg


def mark_success(p: dict) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    update_status(p["key"], needs_tan=False, auth_failed=False, last_error=None, running_until=None,
                  last_success_date=dt.date.today().isoformat(), last_success_at=now.isoformat(timespec="seconds"))


def locked(st: dict) -> bool:
    ru = st.get("running_until")
    return bool(ru) and dt.datetime.fromisoformat(ru) > dt.datetime.now(dt.timezone.utc)


def lock(p: dict) -> None:
    until = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=LOCK_S)
    update_status(p["key"], running_until=until.isoformat(timespec="seconds"))


# ── Abläufe ──────────────────────────────────────────────────────────────────

def berlin_jetzt(now_utc: dt.datetime | None = None) -> dt.datetime:
    """Berliner Ortszeit ohne tz-Datenbank (EU-Regel: Sommerzeit vom letzten
    März-Sonntag 01:00 UTC bis letzten Oktober-Sonntag 01:00 UTC)."""
    n = now_utc or dt.datetime.now(dt.timezone.utc)
    def letzter_sonntag(jahr: int, monat: int) -> dt.datetime:
        d = dt.datetime(jahr, monat, 31, 1, 0, tzinfo=dt.timezone.utc)
        return d - dt.timedelta(days=(d.weekday() + 1) % 7)
    sommer = letzter_sonntag(n.year, 3) <= n < letzter_sonntag(n.year, 10)
    return (n + dt.timedelta(hours=2 if sommer else 1)).replace(tzinfo=None)


def faellig(now_utc: dt.datetime | None = None) -> bool:
    """Takt (User 27.11.2026): 09:00–21:00 Berliner Zeit alle 15 Min.; sonst
    stündlich (erster Viertelstunden-Slot) von 6 bis 23 Uhr; nachts nichts.
    Der Cron läuft alle 15 Min. in UTC — die Uhrzeit-Entscheidung fällt hier,
    damit Sommer-/Winterzeit automatisch stimmt."""
    b = berlin_jetzt(now_utc)
    minuten = b.hour * 60 + b.minute
    if 9 * 60 <= minuten < 21 * 60 + 15:
        return True
    return 6 <= b.hour <= 23 and b.minute < 15


def run_all() -> dict:
    """Stündlicher Lauf: alle eingerichteten Banken ohne TAN, ein gemeinsamer Bericht."""
    if os.environ.get("FINTS_CLOUD", "on").lower() == "off":
        return {"ok": True, "skipped": "FINTS_CLOUD=off"}
    banks = [p for p in BANKS if configured(p)]
    if not banks:
        return {"ok": True, "skipped": "nicht eingerichtet (FINTS_* fehlen)"}
    rows: list[dict] = []
    balances: list[dict] = []
    ok_banks: list[dict] = []
    parts: list[str] = []
    codes: set[str] = set()
    for p in banks:
        row = load_row(p["key"])
        st = row["status"]
        if st.get("auth_failed"):
            parts.append(f"{p['name']}: Anmeldung abgelehnt – PIN/Anmeldename prüfen")
            codes.add("auth_failed")
            continue
        if st.get("needs_tan"):
            parts.append(f"{p['name']}: wartet auf Freigabe (Dashboard: Freigabe erneuern)")
            codes.add("needs_tan")
            continue
        if locked(st):
            parts.append(f"{p['name']}: läuft gerade")
            continue
        lock(p)
        row = load_row(p["key"])
        responses = BankResponses()
        try:
            got, bal = fetch(p, row, responses, wait_until=None)
        except NeedsTan:
            update_status(p["key"], needs_tan=True, last_error="needs_tan", running_until=None)
            log.warning("%s verlangt eine TAN-Freigabe — automatischer Abruf pausiert.", p["name"])
            parts.append(f"{p['name']}: verlangt neue Freigabe (Dashboard: Freigabe erneuern)")
            codes.add("needs_tan")
            continue
        except Exception as e:
            code, msg = fetch_error(p, e, responses)
            update_status(p["key"], running_until=None)
            log.error("%s: Abruf fehlgeschlagen: %s", p["name"], msg)
            parts.append(f"{p['name']}: {msg}")
            codes.add(code)
            continue
        rows.extend(got)
        balances.extend(bal)
        ok_banks.append(p)
        parts.append(f"{p['name']}: {len(got)} Umsätze")

    pp = paypal_balance()
    if pp:
        balances.append(pp)
    code = next((c for c in ("auth_failed", "needs_tan", "error") if c in codes), "ok")
    status = {"ok": code == "ok", "code": code, "message": "Cloud · " + " · ".join(parts), "success": bool(ok_banks)}
    res = send(rows, status, balances)
    for p in ok_banks:
        if res is not None:
            mark_success(p)
        else:
            update_status(p["key"], running_until=None)
    return {"ok": res is not None, "code": code, "message": status["message"], "inserted": (res or {}).get("inserted")}


def renew(bank_key: str) -> dict:
    """Freigabe erneuern (Knopf im Dashboard): wartet auf die pushTAN-Bestätigung."""
    p = next((b for b in BANKS if b["key"] == bank_key), None)
    if not p:
        return {"ok": False, "message": f"Unbekannte Bank: {bank_key}"}
    if not configured(p):
        return {"ok": False, "message": f"{p['name']}: Zugangsdaten fehlen bei Vercel (FINTS_{p['key'].upper()}_USER/_PIN)."}
    row = load_row(p["key"])
    if row["status"].get("auth_failed"):
        return {"ok": False, "code": "auth_failed",
                "message": f"{p['name']} hat die Anmeldung abgelehnt. Erst im Online-Banking mit Anmeldename + PIN anmelden; "
                           f"stimmen PIN oder Anmeldename bei Vercel nicht, dort korrigieren. Danach Sperre im Dashboard lösen."}
    if locked(row["status"]):
        return {"ok": False, "message": f"{p['name']}: Ein Abruf läuft gerade — in einer Minute erneut versuchen."}
    lock(p)
    row = load_row(p["key"])
    responses = BankResponses()
    try:
        got, bal = fetch(p, row, responses, wait_until=time.time() + RENEW_WAIT_S)
    except TanTimeout:
        update_status(p["key"], running_until=None)
        return {"ok": False, "code": "timeout",
                "message": "Die Freigabe wurde nicht rechtzeitig in der Banking-App bestätigt. Nichts passiert — einfach nochmal klicken."}
    except Exception as e:
        code, msg = fetch_error(p, e, responses)
        update_status(p["key"], running_until=None)
        return {"ok": False, "code": code, "message": f"{p['name']}: {msg}"}
    status = {"ok": True, "code": "ok", "message": f"Cloud · {p['name']}: Freigabe erneuert, {len(got)} Umsätze", "success": True}
    res = send(got, status, bal)
    if res is None:
        update_status(p["key"], running_until=None, needs_tan=False)
        return {"ok": False, "message": "Freigabe ok, aber das Dashboard war nicht erreichbar — der nächste stündliche Lauf holt es nach."}
    mark_success(p)
    return {"ok": True, "code": "ok", "message": f"{p['name']}: Freigabe erneuert, {len(got)} Umsätze abgerufen ({res.get('inserted')} neu)."}


# ── HTTP (Vercel) ────────────────────────────────────────────────────────────

class handler(BaseHTTPRequestHandler):
    def _authorized(self) -> bool:
        secret = os.environ.get("CRON_SECRET")
        return bool(secret) and self.headers.get("authorization", "") == f"Bearer {secret}"

    def _json(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._authorized():
            return self._json(401, {"error": "Unauthorized"})
        # ?force=1 (manueller Test) umgeht den Takt
        if "force=1" not in (urllib.parse.urlparse(self.path).query or "") and not faellig():
            return self._json(200, {"ok": True, "skipped": "außerhalb des Takts", "berlin": berlin_jetzt().isoformat(timespec="minutes")})
        try:
            self._json(200, run_all())
        except Exception as e:  # nie den Fehlertext der Bank-Bibliothek ungeprüft durchreichen
            log.exception("run_all fehlgeschlagen")
            self._json(500, {"ok": False, "error": type(e).__name__})

    def do_POST(self):
        if not self._authorized():
            return self._json(401, {"error": "Unauthorized"})
        try:
            n = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"error": "Invalid JSON"})
        try:
            if body.get("action") == "renew":
                return self._json(200, renew(str(body.get("bank") or "")))
            if body.get("action") == "reset_auth":
                # Nach Korrektur von PIN/Anmeldename: Sperre lösen (nächster Versuch nur per Knopf)
                p = next((b for b in BANKS if b["key"] == body.get("bank")), None)
                if not p:
                    return self._json(400, {"error": "Unbekannte Bank"})
                update_status(p["key"], auth_failed=False, needs_tan=True, last_error=None)
                return self._json(200, {"ok": True, "message": f"{p['name']}: Sperre gelöst — jetzt „Freigabe erneuern“ klicken."})
            if body.get("action") == "status":
                return self._json(200, {"ok": True, "banks": [
                    {"key": p["key"], "name": p["name"], "configured": configured(p),
                     **{k: load_row(p["key"])["status"].get(k) for k in ("needs_tan", "auth_failed", "last_success_at", "last_error")}}
                    for p in BANKS]})
            return self._json(400, {"error": "Unbekannte Aktion"})
        except Exception as e:
            log.exception("POST fehlgeschlagen")
            self._json(500, {"ok": False, "error": type(e).__name__})
