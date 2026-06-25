
ALTER TABLE public.voiceops_calls
  ADD COLUMN IF NOT EXISTS retry_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retry_interval_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS retry_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retry_attempts integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_call_id uuid REFERENCES public.voiceops_calls(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS system_prompt_snapshot text,
  ADD COLUMN IF NOT EXISTS retry_brief jsonb;

CREATE INDEX IF NOT EXISTS voiceops_calls_next_retry_idx
  ON public.voiceops_calls (next_retry_at)
  WHERE status = 'scheduled';
