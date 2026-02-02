-- Agent workflow tables for multi-agent orchestration
CREATE TABLE public.agent_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    task_type text NOT NULL, -- 'scrape_jobs', 'analyze_resume', 'generate_cover_letter', 'submit_application', 'check_email'
    status text NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed'
    priority integer DEFAULT 5,
    payload jsonb DEFAULT '{}',
    result jsonb DEFAULT null,
    error_message text DEFAULT null,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    scheduled_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone DEFAULT null,
    completed_at timestamp with time zone DEFAULT null,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Agent execution logs for debugging and monitoring
CREATE TABLE public.agent_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    task_id uuid REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
    agent_name text NOT NULL, -- 'orchestrator', 'resume_agent', 'job_agent', 'application_agent', 'email_agent'
    log_level text NOT NULL DEFAULT 'info', -- 'debug', 'info', 'warn', 'error'
    message text NOT NULL,
    metadata jsonb DEFAULT '{}',
    created_at timestamp with time zone DEFAULT now()
);

-- Email inbox for receiving recruiter responses
CREATE TABLE public.email_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE,
    email_address text NOT NULL UNIQUE,
    email_provider text NOT NULL DEFAULT 'mailgun', -- 'mailgun', 'sendgrid', 'custom'
    is_active boolean DEFAULT true,
    last_synced_at timestamp with time zone DEFAULT null,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Incoming emails from recruiters
CREATE TABLE public.incoming_emails (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    email_account_id uuid REFERENCES public.email_accounts(id) ON DELETE CASCADE,
    application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
    from_email text NOT NULL,
    from_name text DEFAULT null,
    subject text NOT NULL,
    body_text text DEFAULT null,
    body_html text DEFAULT null,
    is_read boolean DEFAULT false,
    is_replied boolean DEFAULT false,
    ai_summary text DEFAULT null,
    ai_sentiment text DEFAULT null, -- 'positive', 'neutral', 'negative', 'rejection', 'interview_request'
    ai_suggested_reply text DEFAULT null,
    received_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- Application automation settings
CREATE TABLE public.automation_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE,
    auto_apply_enabled boolean DEFAULT false,
    daily_apply_limit integer DEFAULT 10,
    apply_hours_start integer DEFAULT 9, -- Hour in UTC when auto-apply starts
    apply_hours_end integer DEFAULT 17, -- Hour in UTC when auto-apply ends
    require_cover_letter boolean DEFAULT true,
    min_match_score integer DEFAULT 70, -- Only auto-apply to jobs with match score >= this
    excluded_companies text[] DEFAULT '{}',
    preferred_job_boards text[] DEFAULT ARRAY['linkedin', 'indeed', 'glassdoor'],
    last_auto_apply_at timestamp with time zone DEFAULT null,
    applications_today integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Job board credentials for automated applications
CREATE TABLE public.job_board_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    job_board text NOT NULL, -- 'linkedin', 'indeed', 'glassdoor', 'ziprecruiter'
    credentials_encrypted jsonb NOT NULL, -- Encrypted credentials
    is_active boolean DEFAULT true,
    last_verified_at timestamp with time zone DEFAULT null,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE(user_id, job_board)
);

-- Enable RLS on all tables
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoming_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_board_credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policies for agent_tasks
CREATE POLICY "Users can view own agent tasks" ON public.agent_tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own agent tasks" ON public.agent_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own agent tasks" ON public.agent_tasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own agent tasks" ON public.agent_tasks FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for agent_logs
CREATE POLICY "Users can view own agent logs" ON public.agent_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own agent logs" ON public.agent_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for email_accounts
CREATE POLICY "Users can view own email accounts" ON public.email_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own email account" ON public.email_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own email account" ON public.email_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own email account" ON public.email_accounts FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for incoming_emails
CREATE POLICY "Users can view own emails" ON public.incoming_emails FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own emails" ON public.incoming_emails FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own emails" ON public.incoming_emails FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for automation_settings
CREATE POLICY "Users can view own automation settings" ON public.automation_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own automation settings" ON public.automation_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own automation settings" ON public.automation_settings FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for job_board_credentials
CREATE POLICY "Users can view own credentials" ON public.job_board_credentials FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own credentials" ON public.job_board_credentials FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own credentials" ON public.job_board_credentials FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own credentials" ON public.job_board_credentials FOR DELETE USING (auth.uid() = user_id);

-- Add updated_at triggers
CREATE TRIGGER update_agent_tasks_updated_at BEFORE UPDATE ON public.agent_tasks FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_email_accounts_updated_at BEFORE UPDATE ON public.email_accounts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_automation_settings_updated_at BEFORE UPDATE ON public.automation_settings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_job_board_credentials_updated_at BEFORE UPDATE ON public.job_board_credentials FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Create automation settings for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);
  
  INSERT INTO public.job_preferences (user_id)
  VALUES (NEW.id);
  
  INSERT INTO public.user_analytics (user_id)
  VALUES (NEW.id);
  
  INSERT INTO public.automation_settings (user_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$;