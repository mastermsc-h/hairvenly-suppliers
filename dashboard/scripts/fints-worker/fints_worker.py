#!/usr/bin/env python3
"""
Hairvenly FinTS-Worker — holt Kontoumsätze der Sparkasse per FinTS/HBCI und
schickt sie an das Dashboard (POST /api/bank/ingest). Dort läuft der Abgleich
gegen offene Shopify-Bestellungen.

Läuft LOKAL auf dem Mac (launchd, stündlich 7–21 Uhr). Geheimnisse:
  - Online-Banking-PIN  → macOS-Schlüsselbund (Dienst "hairvenly-fints")
  - Ingest-Secret       → SUPABASE_SERVICE_ROLE_KEY aus dashboard/.env.local
                          (oder BANK_INGEST_SECRET, falls dort gesetzt)
  - FinTS-Produkt-ID    → config.json (NICHT im Repo — Repo ist öffentlich)

Sicherheitsregel: Der automatische Lauf wartet NIE auf eine TAN. Läuft die
Freigabe ab (alle ~90–180 Tage), schickt die Sparkasse beim nächsten Abruf von
sich aus einmal eine pushTAN — der Worker bestätigt nichts, setzt "needs_tan",
meldet das ans Dashboard und kontaktiert die Bank erst wieder nach einem
interaktiven `fints renew`. So kommt höchstens EINE unerwartete Anfrage aufs
Handy (Mac-Mitteilung erklärt sie) statt einer pro Stunde.

Befehle:
  fints setup      Ersteinrichtung (Anmeldename, PIN, Konto) + erste Freigabe
  fints renew      pushTAN-Freigabe erneuern (alle ~90–180 Tage) + Abruf
  fints run        Abruf ohne TAN (für launchd)
  fints status     Zustand anzeigen
  fints install    launchd-Job installieren (stündlich 7–21 Uhr)
  fints uninstall  launchd-Job entfernen
"""

from __future__ import annotations

import datetime as dt
import getpass
import json
import logging
import logging.handlers
import os
import plistlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

APP_DIR = Path.home() / "Library" / "Application Support" / "hairvenly-fints"
CONFIG_PATH = APP_DIR / "config.json"
STATE_PATH = APP_DIR / "state.bin"
STATUS_PATH = APP_DIR / "status.json"
LOG_PATH = APP_DIR / "worker.log"
KEYCHAIN_SERVICE = "hairvenly-fints"
LAUNCHD_LABEL = "de.hairvenly.fints"
LAUNCHD_PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
SCRIPT_DIR = Path(__file__).resolve().parent
PRODUCT_VERSION = "1.0"

DEFAULT_CONFIG = {
    "blz": "29050101",
    "server": "https://banking-hb6.s-fints-pt-hb.de/fints30",
    "product_id": "",
    "user_id": "",
    "account_ibans": [],
    "dashboard_url": "https://suppliers.hairvenly.de",
    "env_file": str(SCRIPT_DIR.parent.parent / ".env.local"),
    "initial_days": 90,
    "overlap_days": 3,
}

log = logging.getLogger("fints-worker")

# Antwort-Codes der Bank, bei denen PIN/Anmeldename falsch oder gesperrt ist.
# Danach darf KEIN automatischer Versuch mehr laufen: nach 3 Fehlversuchen
# sperrt die Sparkasse den Online-Banking-Zugang.
AUTH_CODES = {"9340", "9910", "9930", "9931", "9941", "9942", "9943", "9944", "9945", "9946", "9947", "9948", "9951"}
AUTH_WORDS = ("pin", "kennung", "anmelde", "gesperrt", "legitimation", "zugang", "benutzer")


class BankResponses:
    """Sammelt die Rückmeldungen der Bank (Code + Text). Gespeist aus
    FinTS3PinTanClient._process_response (siehe make_client) — python-fints
    selbst loggt die Antworten beim Verbindungsaufbau nicht."""

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
        # Sparkasse verschleiert falsche Anmeldedaten: bei unbekanntem Anmeldenamen
        # bzw. falscher PIN kommt NICHT 9931, sondern 9050 "Die Nachricht enthält
        # Fehler" + 9010 "Initialisierung fehlgeschlagen" — ab dem 3. Versuch dann
        # 3938 "vorläufig gesperrt" (nachgemessen 13.10.2026 mit Fake-Kennungen).
        if "3938" in codes or {"9050", "9010"} <= codes:
            return True
        return any(c in AUTH_CODES or any(w in t.lower() for w in AUTH_WORDS) for c, t in self.errors())

    def summary(self) -> str:
        errs = self.errors() or [(c, t) for c, t in self.items if c.startswith("3")]
        return "; ".join(f"{c} {t}".strip() for c, t in errs[:4])


BANK = BankResponses()


# ── Infrastruktur ────────────────────────────────────────────────────────────

def setup_logging(verbose: bool) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(APP_DIR, 0o700)
    fh = logging.handlers.RotatingFileHandler(LOG_PATH, maxBytes=512_000, backupCount=3)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(fh)
    if verbose:
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(logging.Formatter("%(message)s"))
        log.addHandler(sh)
    log.setLevel(logging.INFO)
    # python-fints: Bank-Rückmeldungen (Code + Text) einsammeln und ab WARNING
    # ins Log schreiben. Nachrichten-Inhalte loggt python-fints nur auf DEBUG —
    # die landen nie in der Datei.
    fl = logging.getLogger("fints")
    fl.setLevel(logging.WARNING)
    bank_fh = logging.handlers.RotatingFileHandler(LOG_PATH, maxBytes=512_000, backupCount=3)
    bank_fh.setLevel(logging.WARNING)
    bank_fh.setFormatter(logging.Formatter("%(asctime)s BANK %(message)s"))
    fl.addHandler(bank_fh)
    fl.propagate = False


def load_json(path: Path, default: dict) -> dict:
    try:
        return {**default, **json.loads(path.read_text("utf-8"))}
    except FileNotFoundError:
        return dict(default)


def save_json(path: Path, data: dict) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def load_config() -> dict:
    return load_json(CONFIG_PATH, DEFAULT_CONFIG)


def load_status() -> dict:
    return load_json(STATUS_PATH, {"needs_tan": False, "last_success_date": None})


def notify(title: str, text: str) -> None:
    """macOS-Mitteilung (best effort)."""
    script = f'display notification {json.dumps(text)} with title {json.dumps(title)}'
    subprocess.run(["osascript", "-e", script], capture_output=True)


def keychain_get_pin(user_id: str) -> str | None:
    r = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", user_id, "-w"],
        capture_output=True, text=True,
    )
    return r.stdout.rstrip("\n") if r.returncode == 0 and r.stdout.strip() else None


def keychain_store_pin_interactive(user_id: str) -> bool:
    """`security` fragt die PIN selbst ab — sie taucht weder in argv noch im Log auf."""
    print("\nGleich fragt macOS zweimal nach dem Passwort für den Schlüsselbund-Eintrag.")
    print("→ Dort deine Online-Banking-PIN der Sparkasse eingeben (Eingabe bleibt unsichtbar).\n")
    r = subprocess.run([
        "/usr/bin/security", "add-generic-password", "-U",
        "-s", KEYCHAIN_SERVICE, "-a", user_id,
        "-l", "Hairvenly FinTS (Sparkasse)",
        "-T", "/usr/bin/security",
        "-w",
    ])
    return r.returncode == 0


def ingest_secret(cfg: dict) -> str | None:
    env = Path(cfg["env_file"])
    if not env.exists():
        return None
    values: dict[str, str] = {}
    for line in env.read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values.get("BANK_INGEST_SECRET") or values.get("SUPABASE_SERVICE_ROLE_KEY")


def post_dashboard(cfg: dict, payload: dict) -> dict | None:
    secret = ingest_secret(cfg)
    if not secret:
        log.error("Kein Ingest-Secret gefunden (%s)", cfg["env_file"])
        return None
    req = urllib.request.Request(
        cfg["dashboard_url"].rstrip("/") + "/api/bank/ingest",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        log.error("Dashboard antwortet %s: %s", e.code, e.read().decode("utf-8", "replace")[:300])
    except Exception as e:  # Netzwerk weg etc.
        log.error("Dashboard nicht erreichbar: %s", e)
    return None


def report_status(cfg: dict, ok: bool, code: str, message: str = "") -> None:
    post_dashboard(cfg, {"status": {"ok": ok, "code": code, "message": message}, "transactions": []})


# ── Umsätze → Dashboard-Format ───────────────────────────────────────────────

def _s(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


# Feste IBAN-Längen (ISO 13616) — häufige Länder der Kundschaft.
IBAN_LENGTHS = {
    "DE": 22, "AT": 20, "CH": 21, "LI": 21, "NL": 18, "BE": 16, "LU": 20, "FR": 27, "IT": 27, "ES": 24,
    "PT": 25, "PL": 28, "CZ": 24, "SK": 24, "HU": 28, "SI": 19, "HR": 21, "RO": 24, "BG": 22, "GR": 27,
    "DK": 18, "SE": 24, "NO": 15, "FI": 18, "EE": 20, "LV": 21, "LT": 20, "IE": 22, "GB": 22, "CY": 28,
    "MT": 31, "TR": 26, "MC": 27,
}


def split_iban_name(raw: str | None, iban: str | None) -> tuple[str | None, str | None]:
    """mt940 legt ?31 (IBAN/Kontonr.) standardmäßig mit ?32 (Name) zusammen ins
    Namensfeld: 'DE02100100100006820101MUELLER, ANNA' → (Name, IBAN)."""
    if not raw or iban:
        return raw, iban
    s = raw.strip()
    n = IBAN_LENGTHS.get(s[:2].upper())
    if n and len(s) >= n and s[2:4].isdigit() and s[:n].isalnum():
        return (s[n:].strip() or None), s[:n].upper()
    # Altes Format: reine Kontonummer vorneweg
    i = 0
    while i < len(s) and s[i].isdigit():
        i += 1
    if 5 <= i <= 12:
        return (s[i:].strip() or None), None
    return s, None


def map_transaction(t, account_iban: str | None) -> dict | None:
    """mt940.Transaction → Zeile für /api/bank/ingest. None = unbrauchbar."""
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
    # booking_date = Buchungstag (entry_date), Valuta = date. Fehlt entry_date → date.
    booking = entry or date
    return {
        "booking_date": booking.isoformat()[:10],
        "value_date": date.isoformat()[:10],
        "amount": float(value),
        "currency": str(currency),
        "counterparty_name": name,
        "counterparty_iban": iban,
        "purpose": purpose,
        "posting_text": _s(d.get("posting_text")),
        "end_to_end_ref": e2e,
        "account_iban": account_iban,
    }


# ── FinTS ────────────────────────────────────────────────────────────────────

class NeedsTan(Exception):
    pass


def make_connection(url: str):
    """FinTS-HTTPS-Verbindung, robust gegen abgebrochene Keep-Alive-Verbindungen.

    Gemessen 15.10.2026: Der Sparkassen-Server schließt offen gehaltene
    Verbindungen nach wenigen Sekunden; die nächste Anfrage (z.B. eine
    pushTAN-Statusabfrage) lief dann ins Leere → RemoteDisconnected → ganzer
    Vorgang weg, bevor die Freigabe bestätigt war.
      1. "Connection: close" → jede Anfrage auf frischer Verbindung.
      2. Kam KEINE Antwort (Verbindungsfehler), dieselbe Nachricht bis zu 2×
         neu senden. python-fints zählt die Nachrichtennummer schon vor dem
         Senden hoch — ein Neuaufbau auf Dialogebene würde die Nummer
         verschieben, ein Resend derselben Bytes nicht.
      3. Timeout 60 s, damit der launchd-Lauf nie ewig hängt.
    """
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
                    # Nur wenn sicher keine Antwort kam (Verbindungsebene) — bei
                    # Lese-Timeout könnte die Bank die Nachricht schon verarbeitet haben.
                    if attempt == 2 or not isinstance(e.__cause__, requests.ConnectionError):
                        raise
                    log.warning("Verbindung zur Bank abgebrochen (%s) – sende erneut (%d/2)",
                                type(e.__cause__).__name__, attempt + 1)
                    time.sleep(2)
                    self._fresh()

    return Connection(url)


def make_client(cfg: dict, pin: str, with_state: bool = True):
    from fints.client import FinTS3PinTanClient

    class Client(FinTS3PinTanClient):
        def _process_response(self, dialog, segment, response):
            BANK.add(response.code, response.text)
            return super()._process_response(dialog, segment, response)

    state = STATE_PATH.read_bytes() if with_state and STATE_PATH.exists() else None
    client = Client(
        cfg["blz"], cfg["user_id"], pin, cfg["server"],
        product_id=cfg["product_id"], product_version=PRODUCT_VERSION,
        from_data=state,
    )
    client.connection = make_connection(cfg["server"])
    return client


def save_state(client) -> None:
    data = client.deconstruct(including_private=True)
    APP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.chmod(tmp, 0o600)
    tmp.replace(STATE_PATH)


def resolve_tan(client, res, interactive: bool):
    """Wartet auf pushTAN-Freigabe (interaktiv) oder bricht ab (automatisch)."""
    from fints.client import NeedTANResponse
    if not isinstance(res, NeedTANResponse):
        return res
    if not interactive:
        raise NeedsTan()
    while isinstance(res, NeedTANResponse):
        if res.decoupled:
            print("\n📱 Bitte jetzt in der S-pushTAN-App freigeben …")
            if res.challenge:
                print(f"   Sparkasse: {res.challenge}")
            deadline = time.time() + 300
            while isinstance(res, NeedTANResponse) and time.time() < deadline:
                time.sleep(3)
                res = client.send_tan(res, "")
            if isinstance(res, NeedTANResponse):
                raise RuntimeError("Freigabe nicht innerhalb von 5 Minuten erfolgt.")
            print("✓ Freigabe erhalten.")
        else:
            print(f"\nTAN erforderlich: {res.challenge}")
            tan = input("TAN: ").strip()
            res = client.send_tan(res, tan)
    return res


def select_accounts(cfg: dict, accounts: list, interactive: bool) -> list:
    if cfg["account_ibans"]:
        chosen = [a for a in accounts if a.iban in cfg["account_ibans"]]
        if chosen:
            return chosen
        log.warning("Konfigurierte IBAN(s) nicht im Zugang gefunden — nehme alle.")
    if interactive and len(accounts) > 1:
        print("\nWelche Konten sollen abgeglichen werden?")
        for i, a in enumerate(accounts):
            print(f"  {i}  {a.iban}")
        raw = input("Nummern mit Komma (Enter = alle): ").strip()
        if raw:
            idx = [int(x) for x in raw.split(",") if x.strip().isdigit()]
            accounts = [accounts[i] for i in idx if 0 <= i < len(accounts)]
        cfg["account_ibans"] = [a.iban for a in accounts]
        save_json(CONFIG_PATH, cfg)
    return accounts


def fetch(cfg: dict, interactive: bool, fresh: bool = False) -> list[dict]:
    pin = keychain_get_pin(cfg["user_id"])
    if not pin:
        raise RuntimeError("PIN nicht im Schlüsselbund — bitte `fints setup` ausführen.")
    client = make_client(cfg, pin, with_state=not fresh)

    if interactive and not client.get_current_tan_mechanism():
        client.fetch_tan_mechanisms()
        mech = client.get_tan_mechanisms()
        # pushTAN 2.0 (decoupled) bevorzugen, sonst erstes Zwei-Schritt-Verfahren
        pick = next((k for k, m in mech.items() if "push" in (m.name or "").lower()), None) \
            or next((k for k in mech if k != "999"), None)
        if pick:
            client.set_tan_mechanism(pick)
            print(f"TAN-Verfahren: {mech[pick].name}")
        if client.selected_tan_medium is None and client.is_tan_media_required():
            # KEIN get_tan_media() in eigenem Dialog: die Sparkasse fordert schon
            # bei dessen Init die pushTAN an (3955) und legt beim Beenden mit
            # offener Freigabe auf (RemoteDisconnected, gemessen 15.10.2026).
            # python-fints liefert in genau diesem Fall ohnehin [] → Medium "".
            # pushTAN 2.0 (decoupled) braucht bei der Sparkasse keinen Gerätenamen.
            client.selected_tan_medium = ""
    elif not client.get_current_tan_mechanism():
        raise RuntimeError("Kein gespeicherter Zugang — bitte `fints setup` ausführen.")

    status = load_status()
    today = dt.date.today()
    if status.get("last_success_date") and not fresh:
        last = dt.date.fromisoformat(status["last_success_date"])
        start = max(today - dt.timedelta(days=89), last - dt.timedelta(days=cfg["overlap_days"]))
    else:
        start = today - dt.timedelta(days=min(int(cfg["initial_days"]), 89))

    rows: list[dict] = []
    try:
        # Ein einziger Dialog: Init (ggf. pushTAN) → Freigabe → Konten → Umsätze.
        with client:
            if client.init_tan_response:
                resolve_tan(client, client.init_tan_response, interactive)
            accounts = resolve_tan(client, client.get_sepa_accounts(), interactive)
            for acc in select_accounts(cfg, list(accounts), interactive):
                res = resolve_tan(client, client.get_transactions(acc, start, today), interactive)
                mapped = [m for m in (map_transaction(t, acc.iban) for t in (res or [])) if m]
                log.info("Konto …%s: %d Umsätze seit %s", acc.iban[-4:], len(mapped), start.isoformat())
                rows.extend(mapped)
    except Exception as e:
        # Beendet die Bank den Dialog mit offener Freigabe, wirft das __exit__
        # (HKEND) einen Verbindungsfehler, der NeedsTan überdeckt. Dann trotzdem
        # als "wartet auf TAN" behandeln — sonst versucht der stündliche Lauf es
        # erneut und schickt jedes Mal eine pushTAN aufs Handy.
        if isinstance(e, NeedsTan) or isinstance(e.__context__, NeedsTan):
            raise NeedsTan() from None
        raise
    finally:
        # Zustand (System-ID, BPD/UPD) immer sichern — sonst gilt der Mac
        # beim nächsten Lauf als neues Gerät und die Bank verlangt eine TAN.
        try:
            save_state(client)
        except Exception as e:
            log.warning("Zustand nicht gespeichert: %s", e)
    return rows


def deliver(cfg: dict, rows: list[dict]) -> dict | None:
    res = post_dashboard(cfg, {"status": {"ok": True, "code": "ok", "message": f"{len(rows)} Umsätze"}, "transactions": rows})
    if res is not None:
        status = load_status()
        status.update({
            "needs_tan": False,
            "auth_failed": False,
            "last_success_date": dt.date.today().isoformat(),
            "last_success_at": dt.datetime.now().isoformat(timespec="seconds"),
            "last_error": None,
        })
        save_json(STATUS_PATH, status)
        m = res.get("matching") or {}
        log.info("Dashboard: %s neu von %s · Abgleich: %s automatisch, %s Shadow, %s zu prüfen (Modus %s)",
                 res.get("inserted"), res.get("received"), m.get("autoPaid"), m.get("shadow"), m.get("review"), m.get("mode"))
    return res


# ── Befehle ──────────────────────────────────────────────────────────────────

def cmd_run() -> int:
    cfg = load_config()
    status = load_status()
    if not cfg["user_id"] or not cfg["product_id"]:
        log.info("Nicht eingerichtet — `fints setup` ausführen.")
        return 0
    if status.get("auth_failed"):
        # Bewusst KEIN Bankkontakt: ein weiterer Fehlversuch kann den Zugang sperren.
        log.info("Anmeldung zuletzt abgelehnt — kein Abruf bis `fints setup`.")
        return 0
    if status.get("needs_tan"):
        # Bewusst KEIN Bankkontakt: jeder Versuch würde eine pushTAN aufs Handy schicken.
        log.info("Wartet auf Freigabe (`fints renew`) — kein Abruf.")
        return 0
    try:
        rows = fetch(cfg, interactive=False)
    except NeedsTan:
        status.update({"needs_tan": True, "last_error": "needs_tan"})
        save_json(STATUS_PATH, status)
        log.warning("Bank verlangt pushTAN-Freigabe — automatischer Abruf pausiert.")
        report_status(cfg, False, "needs_tan", "Sparkasse verlangt eine neue pushTAN-Freigabe (fints renew).")
        notify("Hairvenly Bank-Abgleich", "Sparkasse verlangt eine neue Freigabe – pushTAN-Anfrage ignorieren, im Terminal: fints renew")
        return 0
    except Exception as e:
        bank = BANK.summary()
        msg = (f"Bank: {bank}" if bank else f"{type(e).__name__}: {e}")[:300]
        status["last_error"] = msg
        if BANK.auth_failed():
            status["auth_failed"] = True
            save_json(STATUS_PATH, status)
            log.error("Anmeldung abgelehnt (%s) — automatischer Abruf gestoppt.", msg)
            report_status(cfg, False, "auth_failed", f"Anmeldung abgelehnt – bitte `fints setup` ausführen. {msg}")
            notify("Hairvenly Bank-Abgleich", "Sparkasse lehnt die Anmeldung ab. Abruf gestoppt – Terminal: fints setup")
            return 1
        save_json(STATUS_PATH, status)
        log.error("Abruf fehlgeschlagen: %s", msg)
        report_status(cfg, False, "error", msg)
        return 1
    return 0 if deliver(cfg, rows) is not None else 1


def cmd_renew(fresh: bool = False) -> int:
    cfg = load_config()
    if not cfg["user_id"]:
        print("Noch nicht eingerichtet — bitte `fints setup` ausführen.")
        return 1
    print("Verbinde mit der Sparkasse …")
    try:
        rows = fetch(cfg, interactive=True, fresh=fresh)
    except Exception as e:
        bank = BANK.summary()
        log.error("renew fehlgeschlagen: %s: %s | Bank: %s", type(e).__name__, e, bank or "—")
        print("\n✗ Fehlgeschlagen.")
        if bank:
            print(f"  Antwort der Sparkasse: {bank}")
        else:
            print(f"  {type(e).__name__}: {e}")
        status = load_status()
        status["last_error"] = f"Bank: {bank}" if bank else str(e)[:300]
        if BANK.auth_failed():
            status["auth_failed"] = True
            if "3938" in {c for c, _ in BANK.items}:
                print("\n  ⛔ Der Online-Banking-Zugang ist vorläufig GESPERRT.")
                print("     Sperre im Online-Banking/bei der Sparkasse aufheben, erst dann erneut einrichten.")
            print("\n  ⚠️  Die Sparkasse lehnt die Anmeldung ab. NICHT einfach wiederholen –")
            print("     nach 3 Fehlversuchen wird der Online-Banking-Zugang gesperrt.")
            print("     Erst im Browser/in der App mit demselben Anmeldenamen + PIN anmelden.")
            print("     Klappt das: in `fints setup` statt des Anmeldenamens die Legitimations-ID")
            print("     probieren und die PIN neu speichern (Frage „Neu setzen?“ mit j beantworten).")
        save_json(STATUS_PATH, status)
        return 1
    print(f"✓ {len(rows)} Umsätze abgerufen ({sum(1 for r in rows if r['amount'] > 0)} Eingänge). Sende ans Dashboard …")
    res = deliver(cfg, rows)
    if res is None:
        print("✗ Dashboard nicht erreichbar — Details: fints status")
        return 1
    m = res.get("matching") or {}
    print(f"✓ {res.get('inserted')} neu gespeichert. Abgleich ({m.get('mode')}): "
          f"{m.get('autoPaid', 0)} automatisch bezahlt, {m.get('shadow', 0)} sichere Treffer (Shadow), {m.get('review', 0)} zu prüfen.")
    print(f"  → {cfg['dashboard_url'].rstrip('/')}/finances/payments")
    return 0


def cmd_setup() -> int:
    cfg = load_config()
    if not cfg["product_id"]:
        cfg["product_id"] = input("FinTS-Produkt-Registrierungsnummer: ").strip()
    print("Hairvenly FinTS-Einrichtung (Sparkasse Bremen)\n")
    current = cfg["user_id"]
    uid = input(f"Online-Banking-Anmeldename{f' [{current}]' if current else ''}: ").strip() or current
    if not uid:
        print("Anmeldename fehlt.")
        return 1
    cfg["user_id"] = uid
    save_json(CONFIG_PATH, cfg)
    if keychain_get_pin(uid) and input("PIN ist schon im Schlüsselbund. Neu setzen? [j/N] ").strip().lower() != "j":
        pass
    elif not keychain_store_pin_interactive(uid):
        print("PIN konnte nicht gespeichert werden.")
        return 1
    if STATE_PATH.exists():
        STATE_PATH.unlink()
    save_json(STATUS_PATH, {"needs_tan": False, "last_success_date": None})
    rc = cmd_renew(fresh=True)
    if rc == 0 and not LAUNCHD_PLIST.exists():
        if input("\nStündlichen Abruf (7–21 Uhr) jetzt aktivieren? [J/n] ").strip().lower() in ("", "j", "y"):
            return cmd_install()
    return rc


def cmd_status() -> int:
    cfg, st = load_config(), load_status()
    print(f"Anmeldename:      {cfg['user_id'] or '—'}")
    print(f"Konten:           {', '.join('…' + i[-4:] for i in cfg['account_ibans']) or 'alle'}")
    print(f"PIN im Keychain:  {'ja' if cfg['user_id'] and keychain_get_pin(cfg['user_id']) else 'nein'}")
    print(f"Zugang gesichert: {'ja' if STATE_PATH.exists() else 'nein'}")
    print(f"Anmeldung abgel.: {'JA → fints setup' if st.get('auth_failed') else 'nein'}")
    print(f"Wartet auf TAN:   {'JA → fints renew' if st.get('needs_tan') else 'nein'}")
    print(f"Letzter Erfolg:   {st.get('last_success_at') or '—'}")
    print(f"Letzter Fehler:   {st.get('last_error') or '—'}")
    print(f"launchd-Job:      {'installiert' if LAUNCHD_PLIST.exists() else 'nicht installiert'}")
    print(f"Log:              {LOG_PATH}")
    return 0


def cmd_install() -> int:
    python = SCRIPT_DIR / ".venv" / "bin" / "python"
    plist = {
        "Label": LAUNCHD_LABEL,
        "ProgramArguments": [str(python), str(SCRIPT_DIR / "fints_worker.py"), "run"],
        "StartCalendarInterval": [{"Hour": h, "Minute": 7} for h in range(7, 22)],
        "RunAtLoad": False,
        "StandardOutPath": str(APP_DIR / "launchd.log"),
        "StandardErrorPath": str(APP_DIR / "launchd.log"),
        "ProcessType": "Background",
    }
    LAUNCHD_PLIST.parent.mkdir(parents=True, exist_ok=True)
    with open(LAUNCHD_PLIST, "wb") as f:
        plistlib.dump(plist, f)
    uid = os.getuid()
    subprocess.run(["launchctl", "bootout", f"gui/{uid}", str(LAUNCHD_PLIST)], capture_output=True)
    r = subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(LAUNCHD_PLIST)], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"launchctl-Fehler: {r.stderr.strip()}")
        return 1
    print("✓ Stündlicher Abruf aktiv (jeweils um xx:07, 7–21 Uhr). Verpasste Läufe holt macOS nach dem Aufwachen nach.")
    return 0


def cmd_uninstall() -> int:
    subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", str(LAUNCHD_PLIST)], capture_output=True)
    if LAUNCHD_PLIST.exists():
        LAUNCHD_PLIST.unlink()
    print("✓ launchd-Job entfernt.")
    return 0


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    setup_logging(verbose=cmd != "run")
    commands = {
        "run": cmd_run, "renew": cmd_renew, "setup": cmd_setup, "status": cmd_status,
        "install": cmd_install, "uninstall": cmd_uninstall,
    }
    if cmd not in commands:
        print(__doc__)
        return 2
    return commands[cmd]()


if __name__ == "__main__":
    sys.exit(main())
