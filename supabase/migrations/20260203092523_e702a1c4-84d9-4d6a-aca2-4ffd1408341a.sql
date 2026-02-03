-- Create table to store site credentials created by the web agent
CREATE TABLE public.site_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  site_domain TEXT NOT NULL,
  email_used TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  UNIQUE(user_id, site_domain)
);

-- Enable RLS
ALTER TABLE public.site_credentials ENABLE ROW LEVEL SECURITY;

-- Only users can access their own credentials
CREATE POLICY "Users can view own site credentials"
ON public.site_credentials FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own site credentials"
ON public.site_credentials FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own site credentials"
ON public.site_credentials FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own site credentials"
ON public.site_credentials FOR DELETE
USING (auth.uid() = user_id);