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

Sicherheitsregel: Der automatische Lauf löst NIE selbst eine TAN aus. Verlangt
die Bank eine Freigabe, stoppt er, meldet "needs_tan" ans Dashboard und wartet,
bis jemand interaktiv `fints renew` ausführt. Unerwartete pushTAN-Anfragen auf
dem Handy würden sonst dazu erziehen, blind zu bestätigen.

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
    # python-fints loggt Nachrichten-Inhalte auf DEBUG — nie in die Datei.
    logging.getLogger("fints").setLevel(logging.WARNING)


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


def make_client(cfg: dict, pin: str, with_state: bool = True):
    from fints.client import FinTS3PinTanClient
    state = STATE_PATH.read_bytes() if with_state and STATE_PATH.exists() else None
    return FinTS3PinTanClient(
        cfg["blz"], cfg["user_id"], pin, cfg["server"],
        product_id=cfg["product_id"], product_version=PRODUCT_VERSION,
        from_data=state,
    )


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
            media = client.get_tan_media()[1]
            if len(media) == 0:
                client.selected_tan_medium = ""
            elif len(media) == 1:
                client.set_tan_medium(media[0])
            else:
                print("\nMehrere TAN-Geräte gefunden:")
                for i, m in enumerate(media):
                    print(f"  {i}  {m.tan_medium_name}")
                client.set_tan_medium(media[int(input("Nummer: ").strip() or 0)])
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
        with client:
            if client.init_tan_response:
                resolve_tan(client, client.init_tan_response, interactive)
            accounts = resolve_tan(client, client.get_sepa_accounts(), interactive)
            for acc in select_accounts(cfg, list(accounts), interactive):
                res = resolve_tan(client, client.get_transactions(acc, start, today), interactive)
                mapped = [m for m in (map_transaction(t, acc.iban) for t in (res or [])) if m]
                log.info("Konto …%s: %d Umsätze seit %s", acc.iban[-4:], len(mapped), start.isoformat())
                rows.extend(mapped)
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
        notify("Hairvenly Bank-Abgleich", "Sparkasse verlangt eine neue Freigabe. Terminal: fints renew")
        return 0
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"[:300]
        status["last_error"] = msg
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
        print(f"\n✗ Fehlgeschlagen: {type(e).__name__}: {e}")
        log.error("renew fehlgeschlagen: %s: %s", type(e).__name__, e)
        if "PIN" in str(e) or "9931" in str(e) or "9942" in str(e):
            print("  Tipp: PIN/Anmeldename prüfen und `fints setup` erneut ausführen.")
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
