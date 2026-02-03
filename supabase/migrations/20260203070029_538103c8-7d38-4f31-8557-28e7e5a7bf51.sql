-- ============================================
-- EMAIL AGENT TABLES
-- ============================================

-- Email Connections: Stores per-user OAuth tokens for Gmail/Outlook
CREATE TABLE public.email_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook')),
  email_address TEXT NOT NULL,
  scopes_json JSONB DEFAULT '[]'::jsonb,
  access_token_enc TEXT, -- Encrypted access token
  refresh_token_enc TEXT, -- Encrypted refresh token
  expires_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'expired', 'error', 'needs_verification', 'disconnected')),
  last_sync_at TIMESTAMP WITH TIME ZONE,
  email_cursor TEXT, -- For incremental sync
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, email_address)
);

-- Enable RLS
ALTER TABLE public.email_connections ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own email connections" 
ON public.email_connections FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own email connections" 
ON public.email_connections FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own email connections" 
ON public.email_connections FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own email connections" 
ON public.email_connections FOR DELETE 
USING (auth.uid() = user_id);

-- Job Emails: Classified emails from connected inboxes
CREATE TABLE public.job_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  connection_id UUID REFERENCES public.email_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT,
  from_email TEXT NOT NULL,
  from_name TEXT,
  subject TEXT NOT NULL,
  snippet TEXT, -- Short preview
  received_at TIMESTAMP WITH TIME ZONE NOT NULL,
  classification TEXT NOT NULL DEFAULT 'other' CHECK (classification IN (
    'application_confirmation', 'interview_request', 'rejection', 
    'assessment', 'verification', 'mfa_code', 'other_job_related', 'not_job_related'
  )),
  confidence NUMERIC(3,2) DEFAULT 0.5,
  extracted_json JSONB DEFAULT '{}'::jsonb, -- company, role, links, deadline, mfa_code
  linked_application_id UUID REFERENCES public.applications(id) ON DELETE SET NULL,
  is_read BOOLEAN DEFAULT false,
  is_processed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, message_id)
);

-- Enable RLS
ALTER TABLE public.job_emails ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own job emails" 
ON public.job_emails FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own job emails" 
ON public.job_emails FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own job emails" 
ON public.job_emails FOR DELETE 
USING (auth.uid() = user_id);

-- Email Drafts: AI-generated reply drafts
CREATE TABLE public.email_drafts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  connection_id UUID REFERENCES public.email_connections(id) ON DELETE CASCADE,
  job_email_id UUID REFERENCES public.job_emails(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  thread_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'failed')),
  sent_at TIMESTAMP WITH TIME ZONE,
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own email drafts" 
ON public.email_drafts FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own email drafts" 
ON public.email_drafts FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own email drafts" 
ON public.email_drafts FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own email drafts" 
ON public.email_drafts FOR DELETE 
USING (auth.uid() = user_id);

-- Email Agent Settings: Per-user configuration
CREATE TABLE public.email_agent_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  read_emails BOOLEAN DEFAULT true,
  auto_create_drafts BOOLEAN DEFAULT true,
  allow_sending BOOLEAN DEFAULT false,
  send_mode TEXT DEFAULT 'draft_only' CHECK (send_mode IN ('draft_only', 'auto_send')),
  auto_send_templates JSONB DEFAULT '["confirmation"]'::jsonb,
  last_processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_agent_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own email settings" 
ON public.email_agent_settings FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own email settings" 
ON public.email_agent_settings FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own email settings" 
ON public.email_agent_settings FOR UPDATE 
USING (auth.uid() = user_id);

-- Account Connections: For job sites (LinkedIn, Indeed, ATS systems)
CREATE TABLE public.account_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  site_key TEXT NOT NULL CHECK (site_key IN (
    'linkedin', 'indeed', 'glassdoor', 'ziprecruiter',
    'greenhouse', 'lever', 'workday', 'icims', 'smartrecruiters', 'ashby'
  )),
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN (
    'connected', 'expired', 'needs_mfa', 'needs_captcha', 'error', 'disconnected'
  )),
  username_hint TEXT, -- Display hint only, never store password
  session_blob_enc TEXT, -- Encrypted session cookies/tokens
  last_validated_at TIMESTAMP WITH TIME ZONE,
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, site_key)
);

-- Enable RLS
ALTER TABLE public.account_connections ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own account connections" 
ON public.account_connections FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own account connections" 
ON public.account_connections FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own account connections" 
ON public.account_connections FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own account connections" 
ON public.account_connections FOR DELETE 
USING (auth.uid() = user_id);

-- Agent Runs: Track automation runs
CREATE TABLE public.agent_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN (
    'apply_jobs', 'resume_application', 'connect_account', 'email_process', 'test_session'
  )),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'paused', 'completed', 'failed'
  )),
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  summary_json JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own agent runs" 
ON public.agent_runs FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own agent runs" 
ON public.agent_runs FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own agent runs" 
ON public.agent_runs FOR UPDATE 
USING (auth.uid() = user_id);

-- Application Events: Track all events on applications
CREATE TABLE public.application_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'email_received', 'status_change', 'verification_link_used', 
    'interview_scheduled', 'draft_created', 'email_sent', 'agent_action'
  )),
  payload_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies (through applications)
CREATE POLICY "Users can view own application events" 
ON public.application_events FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM applications a 
  WHERE a.id = application_events.application_id 
  AND a.user_id = auth.uid()
));

CREATE POLICY "Users can insert own application events" 
ON public.application_events FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM applications a 
  WHERE a.id = application_events.application_id 
  AND a.user_id = auth.uid()
));

-- Update triggers
CREATE TRIGGER update_email_connections_updated_at
BEFORE UPDATE ON public.email_connections
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_email_drafts_updated_at
BEFORE UPDATE ON public.email_drafts
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_email_agent_settings_updated_at
BEFORE UPDATE ON public.email_agent_settings
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_account_connections_updated_at
BEFORE UPDATE ON public.account_connections
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Indexes for performance
CREATE INDEX idx_email_connections_user_status ON public.email_connections(user_id, status);
CREATE INDEX idx_job_emails_user_classification ON public.job_emails(user_id, classification);
CREATE INDEX idx_job_emails_received ON public.job_emails(user_id, received_at DESC);
CREATE INDEX idx_email_drafts_user_status ON public.email_drafts(user_id, status);
CREATE INDEX idx_account_connections_user_status ON public.account_connections(user_id, status);
CREATE INDEX idx_agent_runs_user_status ON public.agent_runs(user_id, status);
CREATE INDEX idx_application_events_app ON public.application_events(application_id, created_at DESC);