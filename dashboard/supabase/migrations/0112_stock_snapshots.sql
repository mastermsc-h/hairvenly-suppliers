-- Tägliche Lagerbestand-Snapshots für den Entwicklungs-Chart auf /stock.
--
-- Quelle: Stock-Calculation-Sheet (Usbekisch WELLIG + Russisch GLATT).
-- Ein Snapshot pro Tag (upsert auf taken_on) — geschrieben vom täglichen
-- Cron (/api/cron/refresh) UND opportunistisch beim Laden von /stock,
-- damit die Historie auch bei Cron-Ausfällen weiter wächst.

CREATE TABLE IF NOT EXISTS stock_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_on date NOT NULL UNIQUE,
  total_kg numeric(10,2) NOT NULL,
  wellig_kg numeric(10,2) NOT NULL,
  glatt_kg numeric(10,2) NOT NULL,
  wellig_products integer,
  glatt_products integer,
  zero_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_snapshots_taken_on_idx ON stock_snapshots (taken_on);

ALTER TABLE stock_snapshots ENABLE ROW LEVEL SECURITY;

-- Admins (inkl. Mitarbeiter mit is_admin) dürfen lesen + schreiben;
-- der Cron nutzt den Service-Client und umgeht RLS ohnehin.
CREATE POLICY stock_snapshots_admin_all ON stock_snapshots
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));
