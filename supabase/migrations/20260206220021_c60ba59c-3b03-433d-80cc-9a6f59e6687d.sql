
-- Create agent execution logs table for full audit trail
CREATE TABLE public.agent_execution_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  resume_id UUID NOT NULL,
  step TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input TEXT,
  output TEXT,
  gatekeeper_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agent_execution_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own logs
CREATE POLICY "Users can view own execution logs"
ON public.agent_execution_logs
FOR SELECT
USING (auth.uid() = user_id);

-- Service role inserts (edge function uses service role key)
CREATE POLICY "Service role can insert execution logs"
ON public.agent_execution_logs
FOR INSERT
WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_agent_execution_logs_resume ON public.agent_execution_logs(resume_id);
CREATE INDEX idx_agent_execution_logs_user ON public.agent_execution_logs(user_id);
