-- Add use_browserstack setting to browser_profiles (default to false = disabled)
ALTER TABLE public.browser_profiles 
ADD COLUMN IF NOT EXISTS use_browserstack boolean NOT NULL DEFAULT false;