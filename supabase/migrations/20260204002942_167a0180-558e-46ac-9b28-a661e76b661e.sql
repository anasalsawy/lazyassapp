-- Step 1: Add new columns to applications table
ALTER TABLE public.applications 
ADD COLUMN IF NOT EXISTS platform text DEFAULT 'other',
ADD COLUMN IF NOT EXISTS status_source text DEFAULT 'system',
ADD COLUMN IF NOT EXISTS status_message text,
ADD COLUMN IF NOT EXISTS company_name text,
ADD COLUMN IF NOT EXISTS job_title text,
ADD COLUMN IF NOT EXISTS job_url text,
ADD COLUMN IF NOT EXISTS email_thread_id text,
ADD COLUMN IF NOT EXISTS extra_metadata jsonb DEFAULT '{}';