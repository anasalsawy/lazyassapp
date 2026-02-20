-- Add job_agent to allowed run_type values
ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_run_type_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_run_type_check CHECK (run_type = ANY (ARRAY['apply_jobs'::text, 'resume_application'::text, 'connect_account'::text, 'email_process'::text, 'test_session'::text, 'job_agent'::text, 'lever_job_research'::text, 'resume_optimization'::text, 'job_application'::text, 'email_monitoring'::text]));

-- Also add stale to status check
ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_status_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_check CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'paused'::text, 'completed'::text, 'failed'::text, 'stale'::text]));