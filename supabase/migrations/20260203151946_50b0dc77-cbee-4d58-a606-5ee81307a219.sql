-- Create browser_profiles table for persistent Browser Use sessions
CREATE TABLE IF NOT EXISTS public.browser_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  browser_use_profile_id TEXT,
  status TEXT NOT NULL DEFAULT 'not_setup',
  sites_logged_in TEXT[] DEFAULT '{}',
  last_login_at TIMESTAMP WITH TIME ZONE,
  pending_login_site TEXT,
  pending_session_id TEXT,
  pending_task_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.browser_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own browser profile"
  ON public.browser_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own browser profile"
  ON public.browser_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own browser profile"
  ON public.browser_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_browser_profiles_updated_at
  BEFORE UPDATE ON public.browser_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();