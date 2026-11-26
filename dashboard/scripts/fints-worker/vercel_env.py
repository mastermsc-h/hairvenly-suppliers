#!/usr/bin/env python3
"""
Überträgt die Bank-Zugangsdaten vom Mac zu Vercel (Umgebungsvariablen, Typ "Sensitive"),
damit der Bank-Abruf in der Cloud läuft (api/fints.py).

Quelle: ~/Library/Application Support/hairvenly-fints/config.json (Produkt-ID,
Anmeldenamen, PayPal-Client-ID) + macOS-Schlüsselbund (PINs, PayPal-Secret).
Die Werte werden NIE angezeigt — sie gehen per Standardeingabe direkt an
`vercel env add` (nicht über die Befehlszeile, nicht ins Log).

Aufruf (im Ordner dashboard):  python3 scripts/fints-worker/vercel_env.py
macOS fragt dabei ggf. nach dem Schlüsselbund-Zugriff → „Erlauben“.
"""
import json
import subprocess
import sys
from pathlib import Path

APP_DIR = Path.home() / "Library" / "Application Support" / "hairvenly-fints"
DASHBOARD = Path(__file__).resolve().parent.parent.parent


def keychain(service: str, account: str) -> str | None:
    r = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", service, "-a", account, "-w"],
                       capture_output=True, text=True)
    return r.stdout.rstrip("\n") if r.returncode == 0 and r.stdout.strip() else None


def main() -> int:
    cfg = json.loads((APP_DIR / "config.json").read_text("utf-8"))
    targo = (cfg.get("banks") or {}).get("targobank") or {}
    pp = (cfg.get("paypal") or {}).get("client_id")
    werte = {
        "FINTS_PRODUCT_ID": cfg.get("product_id"),
        "FINTS_SPARKASSE_USER": cfg.get("user_id"),
        "FINTS_SPARKASSE_PIN": keychain("hairvenly-fints", cfg.get("user_id", "")),
    }
    if targo.get("user_id"):
        werte["FINTS_TARGOBANK_USER"] = targo["user_id"]
        werte["FINTS_TARGOBANK_PIN"] = keychain("hairvenly-fints-targobank", targo["user_id"])
    if pp:
        werte["PAYPAL_CLIENT_ID"] = pp
        werte["PAYPAL_SECRET"] = keychain("hairvenly-fints-paypal", pp)

    fehlt = [k for k, v in werte.items() if not v]
    if fehlt:
        print("✗ Nicht gefunden:", ", ".join(fehlt), "— nichts übertragen.")
        return 1

    for name, wert in werte.items():
        r = subprocess.run(["npx", "vercel", "env", "add", name, "production", "--sensitive", "--force"],
                           input=wert, text=True, capture_output=True, cwd=DASHBOARD)
        if r.returncode != 0:
            # Fehlermeldung der CLI enthält den Wert nicht (kam per stdin)
            print(f"✗ {name}: {r.stderr.strip()[-300:]}")
            return 1
        print(f"✓ {name} bei Vercel gespeichert")
    print("\nFertig. Sag Claude Bescheid — dann wird neu veröffentlicht und der erste Cloud-Abruf getestet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
