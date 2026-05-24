const { Client } = require('pg');
const c = new Client('postgresql://postgres.xzisnlkqiomvmbslwhvg:yPa1PNWr0KozQlPP@aws-1-eu-central-1.pooler.supabase.com:5432/postgres');
(async () => {
  await c.connect();
  const answer = `IMMER get_available_colors mit search=<Farbcode> aufrufen, BEVOR du sagst "kenne ich nicht" oder "gibt es nicht in unserem System".

Unsere Farbcodes folgen Mustern wie 5P18A, 2T18A, 5T18A, 1A, 4/27, P14 — viele davon existieren tatsächlich im Katalog, auch wenn sie nicht intuitiv aussehen.

REGEL: NIEMALS aus dem Kopf entscheiden ob ein Code existiert. Wenn das Tool nichts findet: nachfragen wo die Kundin den gesehen hat. Aber NIEMALS behaupten "kenne ich nicht" ohne vorher das Tool aufzurufen.

Konkretes Beispiel: 5P18A existiert (US wellige Tape, Bondings, Tressen Classic+Genius, Ponytail) — Bot hat das fälschlicherweise abgelehnt. NIE wieder.`;
  await c.query(`
    INSERT INTO chatbot_faq (slug, topic, question, answer, order_idx, active, notes, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
    ON CONFLICT (slug) DO UPDATE SET
      question=EXCLUDED.question, answer=EXCLUDED.answer, order_idx=EXCLUDED.order_idx,
      active=EXCLUDED.active, notes=EXCLUDED.notes, updated_at=NOW()
  `, [
    'farb-code-immer-tool-aufrufen',
    'farbberatung',
    'Kundin nennt einen konkreten Farbcode (z.B. 5P18A, 6/27, 2T18A) — was tun?',
    answer,
    5,
    true,
    'Pinned via Stuttgart-FRISEUR-Bug — 5P18A fälschlicherweise abgelehnt'
  ]);
  console.log('FAQ farb-code-immer-tool-aufrufen upserted');
  await c.end();
})();
