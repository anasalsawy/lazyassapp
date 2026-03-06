
-- Granular per-step tracking for browser automation
CREATE TABLE public.browser_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step_number integer NOT NULL,
  phase_name text,
  phase_id text,
  
  -- What was requested
  url text NOT NULL,
  actions jsonb DEFAULT '[]'::jsonb,
  selector text,
  expected_outcome text,
  risk_level text DEFAULT 'low',
  
  -- What happened
  result_status text NOT NULL DEFAULT 'pending',
  final_url text,
  page_title text,
  page_content_preview text,
  action_results jsonb DEFAULT '[]'::jsonb,
  extracted_data jsonb,
  error_message text,
  
  -- Timing
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  
  -- Researcher/Planner metadata
  planner_decision_type text,
  researcher_reroute boolean DEFAULT false,
  human_injection text,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by run
CREATE INDEX idx_browser_steps_run_id ON public.browser_steps(run_id);
CREATE INDEX idx_browser_steps_user_id ON public.browser_steps(user_id);

-- RLS
ALTER TABLE public.browser_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own browser steps"
  ON public.browser_steps FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert browser steps"
  ON public.browser_steps FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Also add a source_run_id column to auto_shop_orders to link browser-agent runs
ALTER TABLE public.auto_shop_orders ADD COLUMN IF NOT EXISTS source_run_id uuid;
