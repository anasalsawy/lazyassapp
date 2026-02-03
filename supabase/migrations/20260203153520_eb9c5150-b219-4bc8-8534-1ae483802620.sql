-- Add proxy configuration to browser_profiles
ALTER TABLE public.browser_profiles
ADD COLUMN IF NOT EXISTS proxy_server TEXT,
ADD COLUMN IF NOT EXISTS proxy_username TEXT,
ADD COLUMN IF NOT EXISTS proxy_password_enc TEXT;