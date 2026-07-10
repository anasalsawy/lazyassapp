ALTER TABLE public.voiceops_calls
  ADD COLUMN IF NOT EXISTS supervisor_call_sid text,
  ADD COLUMN IF NOT EXISTS supervisor_status text,
  ADD COLUMN IF NOT EXISTS supervisor_phone text;