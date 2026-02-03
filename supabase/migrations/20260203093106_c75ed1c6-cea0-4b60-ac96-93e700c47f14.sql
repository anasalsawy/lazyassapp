-- Add verification_code column to incoming_emails for quick code retrieval
ALTER TABLE public.incoming_emails ADD COLUMN IF NOT EXISTS verification_code TEXT;
ALTER TABLE public.incoming_emails ADD COLUMN IF NOT EXISTS is_verification_email BOOLEAN DEFAULT false;

-- Allow service role to insert into incoming_emails (needed for webhook)
-- The webhook runs with service role key so this policy update ensures edge function can insert
CREATE POLICY "Service role can insert emails"
ON public.incoming_emails FOR INSERT
TO service_role
WITH CHECK (true);