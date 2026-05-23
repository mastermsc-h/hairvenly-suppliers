-- Token-Usage-Log für jeden Anthropic-Call.
-- Damit wir genau sehen wo Kosten anfallen (Bot-Antwort vs Refine vs Classify
-- vs Guardian vs Auto-Consolidate) und Optimierungen messbar machen können.
CREATE TABLE IF NOT EXISTS chatbot_usage_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- WER hat den Call gemacht?
  purpose text not null,           -- 'respond' | 'refine' | 'classify_category' | 'guardian_analyze' | 'needs_answer' | 'auto_consolidate' | 'grammar' | 'critic_pass' | 'other'
  session_id uuid,                  -- optional: chat_sessions.id
  trigger_user_id uuid,             -- optional: profiles.id (wer's ausgelöst hat — meist null für autonome Calls)

  -- WAS für ein Call?
  model text not null,              -- z.B. 'claude-sonnet-4-5', 'claude-haiku-4-5'
  input_tokens int default 0,
  output_tokens int default 0,
  cache_read_input_tokens int default 0,
  cache_creation_input_tokens int default 0,

  -- Kosten in USD (deterministisch berechnet pro Modell-Tarif)
  cost_usd numeric(10, 6) default 0,

  -- Metadaten
  duration_ms int,                  -- optional: wie lange dauerte der Call
  error text,                       -- bei Fehler: Beschreibung. Bei Erfolg: null.
  extra jsonb default '{}'::jsonb   -- flexibel: tool_calls_count, retry_count, etc.
);

-- Indexe für Dashboard-Queries
CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON chatbot_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_log_purpose_created ON chatbot_usage_log (purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_log_session ON chatbot_usage_log (session_id) WHERE session_id IS NOT NULL;

COMMENT ON TABLE chatbot_usage_log IS
  'Token + Kosten-Logging pro Anthropic-API-Call. Pflicht für Cost-Monitoring + Optimierung.';
