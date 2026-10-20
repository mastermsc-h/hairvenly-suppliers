#!/usr/bin/env python3
"""
Hairvenly FinTS-Worker — holt Kontoumsätze per FinTS/HBCI (Sparkasse Bremen,
Targobank-Gehaltskonto) und schickt sie an das Dashboard (POST /api/bank/ingest).
Dort laufen der Vorkasse-Abgleich und die Kategorisierung (Reiter Kontoumsätze).

Läuft LOKAL auf dem Mac (launchd, stündlich 7–21 Uhr). Geheimnisse:
  - Online-Banking-PIN  → macOS-Schlüsselbund (Dienst "hairvenly-fints",
                          weitere Banken "hairvenly-fints-<bank>")
  - Ingest-Secret       → SUPABASE_SERVICE_ROLE_KEY aus dashboard/.env.local
                          (oder BANK_INGEST_SECRET, falls dort gesetzt)
  - FinTS-Produkt-ID    → config.json (NICHT im Repo — Repo ist öffentlich)

Sicherheitsregel: Der automatische Lauf wartet NIE auf eine TAN. Läuft die
Freigabe ab (alle ~90–180 Tage), schickt die Sparkasse beim nächsten Abruf von
sich aus einmal eine pushTAN — der Worker bestätigt nichts, setzt "needs_tan",
meldet das ans Dashboard und kontaktiert die Bank erst wieder nach einem
interaktiven `fints renew`. So kommt höchstens EINE unerwartete Anfrage aufs
Handy (Mac-Mitteilung erklärt sie) statt einer pro Stunde.

Jede Bank ist unabhängig: braucht eine Bank eine TAN, läuft die andere weiter.
<bank> = sparkasse (Standard) | targobank

Befehle:
  fints setup [bank]       Ersteinrichtung (Anmeldename, PIN, Konto) + erste Freigabe
  fints renew [bank]       TAN-Freigabe erneuern + Abruf (ohne bank: alle, die warten)
  fints backfill [bank] [--since JJJJ-MM-TT]
                           Historie holen (Standard ab 2025-07-01, braucht TAN)
  fints run                Abruf ohne TAN, alle Banken (für launchd)
  fints status             Zustand anzeigen
  fints install            launchd-Job installieren (stündlich 7–21 Uhr)
  fints uninstall          launchd-Job entfernen
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
    # Weitere Banken: {"targobank": {"user_id": "...", "account_ibans": [...]}}
    # Die Sparkasse bleibt aus Kompatibilitätsgründen auf oberster Ebene.
    "banks": {},
}

# Bekannte Banken (Server laut DK-Institutsliste). Die Sparkasse steht oben in DEFAULT_CONFIG.
KNOWN_BANKS = {
    "targobank": {
        "name": "Targobank",
        "blz": "30020900",
        "server": "https://fints.targobank.de/travicretail_fints30pintanbroker/FinTs30PinTanHttpGate",
    },
}
DEFAULT_BACKFILL_SINCE = "2025-07-01"

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


def reset_bank_responses() -> None:
    """Pro Bank frisch sammeln — sonst würde ein Fehler der einen Bank der anderen angelastet."""
    global BANK
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


# ── Banken (Profile) ─────────────────────────────────────────────────────────
#
# Die Sparkasse behält ihre bisherigen Pfade (state.bin, status.json, Keychain-
# Dienst "hairvenly-fints") — ein Umbau darf ihren gespeicherten Zugang nicht
# entwerten (sonst neue Geräte-Freigabe per pushTAN nötig).

def profiles(cfg: dict) -> list[dict]:
    out = [{
        "key": "sparkasse", "name": "Sparkasse",
        "blz": cfg["blz"], "server": cfg["server"],
        "user_id": cfg["user_id"], "account_ibans": list(cfg["account_ibans"]),
        "keychain": KEYCHAIN_SERVICE, "state": STATE_PATH, "status": STATUS_PATH,
    }]
    for key, b in (cfg.get("banks") or {}).items():
        base = KNOWN_BANKS.get(key, {})
        out.append({
            "key": key, "name": b.get("name") or base.get("name") or key.title(),
            "blz": b.get("blz") or base.get("blz"), "server": b.get("server") or base.get("server"),
            "user_id": b.get("user_id", ""), "account_ibans": list(b.get("account_ibans", [])),
            "keychain": f"{KEYCHAIN_SERVICE}-{key}",
            "state": APP_DIR / f"state-{key}.bin", "status": APP_DIR / f"status-{key}.json",
        })
    return out


def get_profile(cfg: dict, key: str, create: bool = False) -> dict | None:
    key = key.lower()
    for p in profiles(cfg):
        if p["key"] == key:
            return p
    if create and key in KNOWN_BANKS:
        cfg.setdefault("banks", {})[key] = {"user_id": "", "account_ibans": []}
        return get_profile(cfg, key)
    return None


def save_profile(cfg: dict, p: dict) -> None:
    if p["key"] == "sparkasse":
        cfg["user_id"], cfg["account_ibans"] = p["user_id"], p["account_ibans"]
    else:
        entry = cfg.setdefault("banks", {}).setdefault(p["key"], {})
        entry.update({"user_id": p["user_id"], "account_ibans": p["account_ibans"]})
    save_json(CONFIG_PATH, cfg)


def load_status(p: dict) -> dict:
    return load_json(p["status"], {"needs_tan": False, "last_success_date": None})


def save_status(p: dict, st: dict) -> None:
    save_json(p["status"], st)


def mark_success(p: dict) -> None:
    st = load_status(p)
    st.update({
        "needs_tan": False,
        "auth_failed": False,
        "last_success_date": dt.date.today().isoformat(),
        "last_success_at": dt.datetime.now().isoformat(timespec="seconds"),
        "last_error": None,
    })
    save_status(p, st)


def notify(title: str, text: str) -> None:
    """macOS-Mitteilung (best effort)."""
    script = f'display notification {json.dumps(text)} with title {json.dumps(title)}'
    subprocess.run(["osascript", "-e", script], capture_output=True)


def keychain_get_pin(p: dict) -> str | None:
    r = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-s", p["keychain"], "-a", p["user_id"], "-w"],
        capture_output=True, text=True,
    )
    return r.stdout.rstrip("\n") if r.returncode == 0 and r.stdout.strip() else None


def keychain_store_pin_interactive(p: dict) -> bool:
    """`security` fragt die PIN selbst ab — sie taucht weder in argv noch im Log auf."""
    print("\nGleich fragt macOS zweimal nach dem Passwort für den Schlüsselbund-Eintrag.")
    print(f"→ Dort deine Online-Banking-PIN der {p['name']} eingeben (Eingabe bleibt unsichtbar).\n")
    r = subprocess.run([
        "/usr/bin/security", "add-generic-password", "-U",
        "-s", p["keychain"], "-a", p["user_id"],
        "-l", f"Hairvenly FinTS ({p['name']})",
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


class TanTimeout(RuntimeError):
    """Freigabe wurde nicht rechtzeitig in der Banking-App bestätigt (kein Bankfehler)."""


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


def make_client(cfg: dict, p: dict, pin: str, with_state: bool = True):
    from fints.client import FinTS3PinTanClient

    class Client(FinTS3PinTanClient):
        def _process_response(self, dialog, segment, response):
            BANK.add(response.code, response.text)
            return super()._process_response(dialog, segment, response)

    state_path: Path = p["state"]
    state = state_path.read_bytes() if with_state and state_path.exists() else None
    client = Client(
        p["blz"], p["user_id"], pin, p["server"],
        product_id=cfg["product_id"], product_version=PRODUCT_VERSION,
        from_data=state,
    )
    client.connection = make_connection(p["server"])
    return client


def save_state(client, p: dict) -> None:
    data = client.deconstruct(including_private=True)
    APP_DIR.mkdir(parents=True, exist_ok=True)
    state_path: Path = p["state"]
    tmp = state_path.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.chmod(tmp, 0o600)
    tmp.replace(state_path)


def resolve_tan(client, res, interactive: bool):
    """Wartet auf pushTAN-Freigabe (interaktiv) oder bricht ab (automatisch)."""
    from fints.client import NeedTANResponse
    if not isinstance(res, NeedTANResponse):
        return res
    if not interactive:
        raise NeedsTan()
    while isinstance(res, NeedTANResponse):
        if res.decoupled:
            print("\n📱 Bitte jetzt in der Banking-App freigeben …")
            if res.challenge:
                print(f"   Bank: {res.challenge}")
            deadline = time.time() + 300
            while isinstance(res, NeedTANResponse) and time.time() < deadline:
                time.sleep(3)
                res = client.send_tan(res, "")
            if isinstance(res, NeedTANResponse):
                raise TanTimeout("Freigabe nicht innerhalb von 5 Minuten erfolgt.")
            print("✓ Freigabe erhalten.")
        else:
            matrix = getattr(res, "challenge_matrix", None)
            if matrix:
                # photoTAN/QR-TAN: Grafik anzeigen, mit der Banking-App scannen
                mime, data = matrix
                path = APP_DIR / ("tan-grafik.png" if "png" in str(mime) else "tan-grafik.jpg")
                path.write_bytes(data)
                os.chmod(path, 0o600)
                subprocess.run(["open", str(path)], capture_output=True)
                print(f"\n🖼  TAN-Grafik geöffnet ({path.name}) – mit der Banking-App scannen.")
            elif getattr(res, "challenge_hhduc", None):
                print("\n⚠️  Die Bank verlangt chipTAN mit Flickercode – das unterstützt der Worker nicht.")
                print("   Bitte im Online-Banking ein App-Verfahren (z.B. Banking-App/pushTAN) aktivieren.")
            print(f"\nTAN erforderlich: {res.challenge}")
            tan = input("TAN: ").strip()
            res = client.send_tan(res, tan)
            if matrix:
                try:
                    path.unlink()
                except OSError:
                    pass
    return res


def select_accounts(cfg: dict, p: dict, accounts: list, interactive: bool) -> list:
    if p["account_ibans"]:
        chosen = [a for a in accounts if a.iban in p["account_ibans"]]
        if chosen:
            return chosen
        log.warning("%s: konfigurierte IBAN(s) nicht im Zugang gefunden — nehme alle.", p["name"])
    if interactive and len(accounts) > 1:
        print(f"\nWelche Konten der {p['name']} sollen abgerufen werden?")
        for i, a in enumerate(accounts):
            print(f"  {i}  {a.iban}")
        raw = input("Nummern mit Komma (Enter = alle): ").strip()
        if raw:
            idx = [int(x) for x in raw.split(",") if x.strip().isdigit()]
            accounts = [accounts[i] for i in idx if 0 <= i < len(accounts)]
    if interactive:
        p["account_ibans"] = [a.iban for a in accounts]
        save_profile(cfg, p)
    return accounts


def choose_tan_mechanism(client, p: dict, interactive: bool) -> None:
    client.fetch_tan_mechanisms()
    mech = client.get_tan_mechanisms()
    candidates = [k for k in mech if k != "999"]
    # App-Freigabe (decoupled) bevorzugen: Sparkasse pushTAN 2.0, sonst Banking-App
    preferred = next((k for k in candidates if "push" in (mech[k].name or "").lower()), None) \
        or next((k for k in candidates if any(w in (mech[k].name or "").lower() for w in ("app", "secure", "decoupled"))), None)
    pick = preferred
    if not pick and len(candidates) > 1 and interactive:
        print("\nWelches TAN-Verfahren?")
        for i, k in enumerate(candidates):
            print(f"  {i}  {mech[k].name} ({k})")
        raw = input("Nummer [0]: ").strip()
        pick = candidates[int(raw)] if raw.isdigit() and int(raw) < len(candidates) else candidates[0]
    pick = pick or (candidates[0] if candidates else None)
    if pick:
        client.set_tan_mechanism(pick)
        print(f"TAN-Verfahren: {mech[pick].name}")


def choose_tan_medium(client, p: dict, interactive: bool) -> None:
    if client.selected_tan_medium is not None or not client.is_tan_media_required():
        return
    if p["key"] == "sparkasse":
        # KEIN get_tan_media() in eigenem Dialog: die Sparkasse fordert schon
        # bei dessen Init die pushTAN an (3955) und legt beim Beenden mit
        # offener Freigabe auf (RemoteDisconnected, gemessen 15.10.2026).
        # python-fints liefert in genau diesem Fall ohnehin [] → Medium "".
        # pushTAN 2.0 (decoupled) braucht bei der Sparkasse keinen Gerätenamen.
        client.selected_tan_medium = ""
        return
    try:
        media = list(client.get_tan_media()[1] or [])
    except Exception as e:  # Bank verweigert die Abfrage → ohne Gerätenamen versuchen
        log.warning("%s: TAN-Medien nicht abrufbar (%s)", p["name"], e)
        media = []
    if not media:
        client.selected_tan_medium = ""
        return
    if len(media) > 1 and interactive:
        print("\nWelches TAN-Gerät?")
        for i, m in enumerate(media):
            print(f"  {i}  {getattr(m, 'tan_medium_name', None) or m}")
        raw = input("Nummer [0]: ").strip()
        client.set_tan_medium(media[int(raw)] if raw.isdigit() and int(raw) < len(media) else media[0])
    else:
        client.set_tan_medium(media[0])


def fetch(cfg: dict, p: dict, interactive: bool, fresh: bool = False, since: dt.date | None = None) -> tuple[list[dict], list[dict]]:
    pin = keychain_get_pin(p)
    if not pin:
        raise RuntimeError(f"PIN nicht im Schlüsselbund — bitte `fints setup {p['key']}` ausführen.")
    client = make_client(cfg, p, pin, with_state=not fresh)

    if interactive and not client.get_current_tan_mechanism():
        choose_tan_mechanism(client, p, interactive)
        choose_tan_medium(client, p, interactive)
    elif not client.get_current_tan_mechanism():
        raise RuntimeError(f"Kein gespeicherter Zugang — bitte `fints setup {p['key']}` ausführen.")

    status = load_status(p)
    today = dt.date.today()
    if since is not None:
        # Historie (backfill): älter als 90 Tage verlangt die Bank eine TAN (PSD2)
        start = since
    elif status.get("last_success_date") and not fresh:
        last = dt.date.fromisoformat(status["last_success_date"])
        start = max(today - dt.timedelta(days=89), last - dt.timedelta(days=cfg["overlap_days"]))
    else:
        start = today - dt.timedelta(days=min(int(cfg["initial_days"]), 89))

    rows: list[dict] = []
    balances: list[dict] = []
    umsaetze_fertig = False
    try:
        # Ein einziger Dialog: Init (ggf. pushTAN) → Freigabe → Konten → Umsätze → Salden.
        with client:
            if client.init_tan_response:
                resolve_tan(client, client.init_tan_response, interactive)
            accounts = resolve_tan(client, client.get_sepa_accounts(), interactive)
            chosen = select_accounts(cfg, p, list(accounts), interactive)
            for acc in chosen:
                res = resolve_tan(client, client.get_transactions(acc, start, today), interactive)
                mapped = [m for m in (map_transaction(t, acc.iban) for t in (res or [])) if m]
                first = min((m["booking_date"] for m in mapped), default="—")
                log.info("%s …%s: %d Umsätze seit %s (frühester %s)", p["name"], acc.iban[-4:], len(mapped), start.isoformat(), first)
                rows.extend(mapped)
            umsaetze_fertig = True
            balances = fetch_balances(client, p, chosen)
    except Exception as e:
        # Fehler NACH den Umsätzen (z.B. beim Kontostand oder Dialogende): Umsätze trotzdem liefern
        if umsaetze_fertig and not any(isinstance(x, (NeedsTan, TanTimeout)) for x in (e, e.__context__)):
            log.warning("%s: Fehler nach dem Umsatzabruf ignoriert (%s: %s)", p["name"], type(e).__name__, e)
            return rows, balances
        # Beendet die Bank den Dialog mit offener Freigabe, wirft das __exit__
        # (HKEND) einen Verbindungsfehler, der NeedsTan überdeckt. Dann trotzdem
        # als "wartet auf TAN" behandeln — sonst versucht der stündliche Lauf es
        # erneut und schickt jedes Mal eine pushTAN aufs Handy.
        if isinstance(e, NeedsTan) or isinstance(e.__context__, NeedsTan):
            raise NeedsTan() from None
        if isinstance(e, TanTimeout) or isinstance(e.__context__, TanTimeout):
            raise TanTimeout("Freigabe nicht innerhalb von 5 Minuten erfolgt.") from None
        raise
    finally:
        # Zustand (System-ID, BPD/UPD) immer sichern — sonst gilt der Mac
        # beim nächsten Lauf als neues Gerät und die Bank verlangt eine TAN.
        try:
            save_state(client, p)
        except Exception as e:
            log.warning("Zustand nicht gespeichert: %s", e)
    return rows, balances


def fetch_balances(client, p: dict, accounts: list) -> list[dict]:
    """Kontostand je Konto (HKSAL) im selben Dialog. Verlangt die Bank dafür eine TAN,
    wird NICHTS bestätigt und abgebrochen — Salden sind nur eine Zugabe."""
    from fints.client import NeedTANResponse
    out: list[dict] = []
    for acc in accounts:
        try:
            bal = client.get_balance(acc)
        except Exception as e:
            log.warning("%s …%s: Kontostand nicht abrufbar (%s)", p["name"], acc.iban[-4:], e)
            break
        if isinstance(bal, NeedTANResponse) or bal is None:
            log.info("%s: Kontostand verlangt TAN — übersprungen", p["name"])
            break
        try:
            amount = getattr(bal.amount, "amount", bal.amount)
            out.append({"account_iban": acc.iban, "saldo": float(amount), "stand": bal.date.isoformat()[:10]})
            log.info("%s …%s: Kontostand %.2f (%s)", p["name"], acc.iban[-4:], float(amount), bal.date.isoformat()[:10])
        except Exception as e:
            log.warning("%s …%s: Kontostand unlesbar (%s)", p["name"], acc.iban[-4:], e)
    return out


def drain(cfg: dict, res: dict, rounds: int = 10) -> dict:
    """Abgleich + Kategorisierung haben pro Aufruf ein Zeitbudget (Vercel: 60 s) —
    den Rest in Folgeaufrufen nachholen."""
    m = dict(res.get("matching") or {})
    k = dict(m.get("kategorien") or {})
    for _ in range(rounds):
        if not m.get("remaining") and not k.get("remaining"):
            break
        more = post_dashboard(cfg, {"action": "match"})
        mm = (more or {}).get("matching") or {}
        kk = mm.get("kategorien") or {}
        if not more or (not mm.get("processed") and not kk.get("geprueft")):
            break
        for key in ("processed", "autoPaid", "shadow", "review", "ignored"):
            m[key] = (m.get(key) or 0) + (mm.get(key) or 0)
        m["remaining"] = mm.get("remaining", 0)
        k["remaining"] = kk.get("remaining", 0)
    m["kategorien"] = k
    return m


def send(cfg: dict, rows: list[dict], status: dict, rounds: int = 10, balances: list[dict] | None = None) -> dict | None:
    """Umsätze (+ Kontostände) + Status ans Dashboard; danach Abgleich/Kategorisierung zu Ende bringen."""
    res = post_dashboard(cfg, {"status": status, "transactions": rows, "balances": balances or []})
    if res is None:
        return None
    res["matching"] = drain(cfg, res, rounds)
    m = res["matching"]
    log.info("Dashboard: %s neu von %s · Abgleich: %s automatisch, %s Shadow, %s zu prüfen, %s offen (Modus %s)",
             res.get("inserted"), res.get("received"), m.get("autoPaid"), m.get("shadow"), m.get("review"),
             m.get("remaining"), m.get("mode"))
    return res


def fetch_error(p: dict, e: Exception) -> tuple[str, str]:
    """(code, Meldung) für einen fehlgeschlagenen Abruf; vermerkt den Zustand der Bank."""
    st = load_status(p)
    bank = BANK.summary()
    msg = (f"Bank: {bank}" if bank else f"{type(e).__name__}: {e}")[:300]
    st["last_error"] = msg
    code = "error"
    if BANK.auth_failed():
        st["auth_failed"] = True
        code = "auth_failed"
    save_status(p, st)
    return code, msg


# ── Befehle ──────────────────────────────────────────────────────────────────

def configured_profiles(cfg: dict) -> list[dict]:
    return [p for p in profiles(cfg) if p["user_id"]]


def cmd_run(args: list[str]) -> int:
    """Stündlicher Lauf (launchd): alle Banken ohne TAN, ein gemeinsamer Bericht."""
    cfg = load_config()
    banks = configured_profiles(cfg)
    if not banks or not cfg["product_id"]:
        log.info("Nicht eingerichtet — `fints setup` ausführen.")
        return 0
    rows: list[dict] = []
    balances: list[dict] = []
    ok_banks: list[dict] = []
    parts: list[str] = []
    codes: set[str] = set()
    for p in banks:
        st = load_status(p)
        if st.get("auth_failed"):
            # Bewusst KEIN Bankkontakt: ein weiterer Fehlversuch kann den Zugang sperren.
            log.info("%s: Anmeldung zuletzt abgelehnt — kein Abruf bis `fints setup %s`.", p["name"], p["key"])
            parts.append(f"{p['name']}: Anmeldung abgelehnt (fints setup {p['key']})")
            codes.add("auth_failed")
            continue
        if st.get("needs_tan"):
            # Bewusst KEIN Bankkontakt: jeder Versuch würde eine TAN-Anfrage aufs Handy schicken.
            log.info("%s: wartet auf Freigabe (`fints renew %s`) — kein Abruf.", p["name"], p["key"])
            parts.append(f"{p['name']}: wartet auf TAN-Freigabe (fints renew {p['key']})")
            codes.add("needs_tan")
            continue
        reset_bank_responses()
        try:
            got, bal = fetch(cfg, p, interactive=False)
        except NeedsTan:
            st.update({"needs_tan": True, "last_error": "needs_tan"})
            save_status(p, st)
            log.warning("%s verlangt eine TAN-Freigabe — automatischer Abruf pausiert.", p["name"])
            notify("Hairvenly Bank-Abgleich",
                   f"{p['name']} verlangt eine neue Freigabe – Anfrage am Handy ignorieren, im Terminal: fints renew {p['key']}")
            parts.append(f"{p['name']}: verlangt neue TAN-Freigabe (fints renew {p['key']})")
            codes.add("needs_tan")
            continue
        except Exception as e:
            code, msg = fetch_error(p, e)
            if code == "auth_failed":
                log.error("%s: Anmeldung abgelehnt (%s) — automatischer Abruf gestoppt.", p["name"], msg)
                notify("Hairvenly Bank-Abgleich", f"{p['name']} lehnt die Anmeldung ab. Abruf gestoppt – Terminal: fints setup {p['key']}")
                parts.append(f"{p['name']}: Anmeldung abgelehnt – {msg}")
            else:
                log.error("%s: Abruf fehlgeschlagen: %s", p["name"], msg)
                parts.append(f"{p['name']}: {msg}")
            codes.add(code)
            continue
        rows.extend(got)
        balances.extend(bal)
        ok_banks.append(p)
        parts.append(f"{p['name']}: {len(got)} Umsätze")

    # Schlimmster Zustand bestimmt den Code; "success" = mindestens eine Bank hat geliefert.
    code = next((c for c in ("auth_failed", "needs_tan", "error") if c in codes), "ok")
    status = {"ok": code == "ok", "code": code, "message": " · ".join(parts), "success": bool(ok_banks)}
    res = send(cfg, rows, status, balances=balances)
    if res is not None:
        for p in ok_banks:
            mark_success(p)
    return 0 if res is not None and code in ("ok", "needs_tan") else 1


def renew_one(cfg: dict, p: dict, fresh: bool = False) -> int:
    print(f"Verbinde mit der {p['name']} …")
    reset_bank_responses()
    try:
        rows, balances = fetch(cfg, p, interactive=True, fresh=fresh)
    except TanTimeout:
        log.warning("renew %s: Freigabe nicht rechtzeitig bestätigt", p["key"])
        print(f"\n✗ Die Freigabe wurde nicht innerhalb von 5 Minuten in der {p['name']}-App bestätigt.")
        print(f"  Nichts passiert — einfach erneut starten: fints renew {p['key']}")
        return 1
    except Exception as e:
        bank = BANK.summary()
        log.error("renew %s fehlgeschlagen: %s: %s | Bank: %s", p["key"], type(e).__name__, e, bank or "—")
        print("\n✗ Fehlgeschlagen.")
        print(f"  Antwort der {p['name']}: {bank}" if bank else f"  {type(e).__name__}: {e}")
        code, _ = fetch_error(p, e)
        if code == "auth_failed":
            if "3938" in {c for c, _ in BANK.items}:
                print("\n  ⛔ Der Online-Banking-Zugang ist vorläufig GESPERRT.")
                print("     Sperre im Online-Banking/bei der Bank aufheben, erst dann erneut einrichten.")
            print(f"\n  ⚠️  Die {p['name']} lehnt die Anmeldung ab. NICHT einfach wiederholen –")
            print("     nach 3 Fehlversuchen wird der Online-Banking-Zugang gesperrt.")
            print("     Erst im Browser/in der App mit demselben Anmeldenamen + PIN anmelden.")
            print(f"     Klappt das: in `fints setup {p['key']}` ggf. die Legitimations-ID statt des")
            print("     Anmeldenamens probieren und die PIN neu speichern („Neu setzen?“ mit j beantworten).")
        return 1
    print(f"✓ {len(rows)} Umsätze abgerufen ({sum(1 for r in rows if r['amount'] > 0)} Eingänge). Sende ans Dashboard …")
    res = send(cfg, rows, {"ok": True, "code": "ok", "message": f"{p['name']}: {len(rows)} Umsätze", "success": True}, balances=balances)
    if res is None:
        print("✗ Dashboard nicht erreichbar — Details: fints status")
        return 1
    mark_success(p)
    m = res.get("matching") or {}
    print(f"✓ {res.get('inserted')} neu gespeichert. Abgleich ({m.get('mode')}): "
          f"{m.get('autoPaid', 0)} automatisch bezahlt, {m.get('shadow', 0)} sichere Treffer (Shadow), {m.get('review', 0)} zu prüfen.")
    print(f"  → {cfg['dashboard_url'].rstrip('/')}/finances/bank")
    return 0


def cmd_renew(args: list[str]) -> int:
    cfg = load_config()
    banks = configured_profiles(cfg)
    if not banks:
        print("Noch nicht eingerichtet — bitte `fints setup` ausführen.")
        return 1
    if args:
        p = get_profile(cfg, args[0])
        if not p or not p["user_id"]:
            print(f"Bank „{args[0]}“ ist nicht eingerichtet — `fints setup {args[0]}`.")
            return 1
        targets = [p]
    else:
        # Ohne Angabe: alle, die auf eine Freigabe warten — sonst alle
        targets = [p for p in banks if load_status(p).get("needs_tan")] or banks
    rc = 0
    for p in targets:
        rc |= renew_one(cfg, p)
    return rc


def cmd_setup(args: list[str]) -> int:
    key = (args[0] if args else "sparkasse").lower()
    cfg = load_config()
    p = get_profile(cfg, key, create=True)
    if not p:
        print(f"Unbekannte Bank „{key}“. Möglich: sparkasse, {', '.join(KNOWN_BANKS)}")
        return 1
    if not cfg["product_id"]:
        cfg["product_id"] = input("FinTS-Produkt-Registrierungsnummer: ").strip()
    print(f"Hairvenly FinTS-Einrichtung ({p['name']}, BLZ {p['blz']})\n")
    current = p["user_id"]
    uid = input(f"Online-Banking-Anmeldename / Kundennummer{f' [{current}]' if current else ''}: ").strip() or current
    if not uid:
        print("Anmeldename fehlt.")
        return 1
    p["user_id"] = uid
    save_profile(cfg, p)
    if keychain_get_pin(p) and input("PIN ist schon im Schlüsselbund. Neu setzen? [j/N] ").strip().lower() != "j":
        pass
    elif not keychain_store_pin_interactive(p):
        print("PIN konnte nicht gespeichert werden.")
        return 1
    state_path: Path = p["state"]
    if state_path.exists():
        state_path.unlink()
    save_status(p, {"needs_tan": False, "last_success_date": None})
    rc = renew_one(cfg, p, fresh=True)
    if rc == 0 and not LAUNCHD_PLIST.exists():
        if input("\nStündlichen Abruf (7–21 Uhr) jetzt aktivieren? [J/n] ").strip().lower() in ("", "j", "y"):
            return cmd_install([])
    return rc


def cmd_backfill(args: list[str]) -> int:
    """Historie holen. Älter als 90 Tage = TAN-pflichtig (PSD2) → nur interaktiv."""
    since_raw = DEFAULT_BACKFILL_SINCE
    keys: list[str] = []
    it = iter(args)
    for a in it:
        if a == "--since":
            since_raw = next(it, since_raw)
        elif a.startswith("--since="):
            since_raw = a.split("=", 1)[1]
        else:
            keys.append(a.lower())
    try:
        since = dt.date.fromisoformat(since_raw)
    except ValueError:
        print(f"Ungültiges Datum: {since_raw} (Format JJJJ-MM-TT)")
        return 1
    cfg = load_config()
    banks = configured_profiles(cfg)
    if keys:
        banks = [p for p in banks if p["key"] in keys]
    if not banks:
        print("Keine eingerichtete Bank gefunden — erst `fints setup [bank]`.")
        return 1
    rc = 0
    for p in banks:
        print(f"\n━━ {p['name']}: Umsätze seit {since.strftime('%d.%m.%Y')} ━━")
        reset_bank_responses()
        try:
            rows, balances = fetch(cfg, p, interactive=True, since=since)
        except TanTimeout:
            log.warning("backfill %s: Freigabe nicht rechtzeitig bestätigt", p["key"])
            print(f"✗ Die Freigabe wurde nicht innerhalb von 5 Minuten in der {p['name']}-App bestätigt.")
            print(f"  Nichts passiert — einfach erneut starten und die Anfrage in der App bestätigen: fints backfill {p['key']}")
            rc = 1
            continue
        except Exception as e:
            bank = BANK.summary()
            log.error("backfill %s fehlgeschlagen: %s: %s | Bank: %s", p["key"], type(e).__name__, e, bank or "—")
            print(f"✗ Fehlgeschlagen. {('Antwort der ' + p['name'] + ': ' + bank) if bank else f'{type(e).__name__}: {e}'}")
            print("  Manche Banken liefern nur eine begrenzte Historie — ggf. mit späterem --since erneut versuchen.")
            fetch_error(p, e)
            rc = 1
            continue
        mark_success(p)
        by_acc: dict[str, list[str]] = {}
        for r in rows:
            by_acc.setdefault(r["account_iban"] or "?", []).append(r["booking_date"])
        for iban, dates in by_acc.items():
            print(f"  Konto …{iban[-4:]}: {len(dates)} Umsätze, frühester {min(dates)}")
        if not rows:
            continue
        # In Paketen senden: Import + Abgleich + Kategorisierung müssen je Aufruf in 60 s passen.
        rows.sort(key=lambda r: r["booking_date"])
        inserted = 0
        for i in range(0, len(rows), 600):
            chunk = rows[i:i + 600]
            res = send(cfg, chunk, {"ok": True, "code": "ok", "message": f"Historie {p['name']}: {len(rows)} Umsätze", "success": True}, rounds=40, balances=balances if i == 0 else None)
            if res is None:
                print("✗ Dashboard nicht erreichbar — Rest später erneut mit `fints backfill` (doppelte werden verworfen).")
                return 1
            inserted += int(res.get("inserted") or 0)
            print(f"  … {min(i + 600, len(rows))}/{len(rows)} übertragen")
        print(f"✓ {inserted} neu gespeichert (bereits vorhandene werden automatisch verworfen).")
    print(f"\n→ {cfg['dashboard_url'].rstrip('/')}/finances/bank")
    return rc


def cmd_status(args: list[str]) -> int:
    cfg = load_config()
    print(f"launchd-Job:      {'installiert' if LAUNCHD_PLIST.exists() else 'nicht installiert'}")
    print(f"Log:              {LOG_PATH}")
    for p in profiles(cfg):
        st = load_status(p)
        print(f"\n── {p['name']} ({p['key']}) ──")
        if not p["user_id"]:
            print(f"Nicht eingerichtet → fints setup {p['key']}")
            continue
        print(f"Anmeldename:      {p['user_id']}")
        print(f"Konten:           {', '.join('…' + i[-4:] for i in p['account_ibans']) or 'alle'}")
        print(f"PIN im Keychain:  {'ja' if keychain_get_pin(p) else 'nein'}")
        print(f"Zugang gesichert: {'ja' if Path(p['state']).exists() else 'nein'}")
        print(f"Anmeldung abgel.: {'JA → fints setup ' + p['key'] if st.get('auth_failed') else 'nein'}")
        print(f"Wartet auf TAN:   {'JA → fints renew ' + p['key'] if st.get('needs_tan') else 'nein'}")
        print(f"Letzter Erfolg:   {st.get('last_success_at') or '—'}")
        print(f"Letzter Fehler:   {st.get('last_error') or '—'}")
    for key in KNOWN_BANKS:
        if not get_profile(cfg, key):
            print(f"\n── {KNOWN_BANKS[key]['name']} ({key}) ──\nNicht eingerichtet → fints setup {key}")
    return 0


def cmd_install(args: list[str] | None = None) -> int:
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


def cmd_uninstall(args: list[str] | None = None) -> int:
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
        "backfill": cmd_backfill, "install": cmd_install, "uninstall": cmd_uninstall,
    }
    if cmd not in commands:
        print(__doc__)
        return 2
    return commands[cmd](sys.argv[2:])


if __name__ == "__main__":
    sys.exit(main())
