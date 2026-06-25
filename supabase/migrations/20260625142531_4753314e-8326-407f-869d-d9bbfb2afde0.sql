ALTER TABLE public.voiceops_calls ADD COLUMN IF NOT EXISTS operator_request text;
ALTER TABLE public.voiceops_calls ADD COLUMN IF NOT EXISTS operator_reply text;
ALTER TABLE public.voiceops_calls ADD COLUMN IF NOT EXISTS operator_reply_at timestamp with time zone;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voiceops_calls TO authenticated;
GRANT ALL ON public.voiceops_calls TO service_role;

ALTER TABLE public.voiceops_calls ENABLE ROW LEVEL SECURITY;

-- Ensure policies exist (re-create safely)
DROP POLICY IF EXISTS "Users can view own voiceops calls" ON public.voiceops_calls;
DROP POLICY IF EXISTS "Users can insert own voiceops calls" ON public.voiceops_calls;
DROP POLICY IF EXISTS "Users can update own voiceops calls" ON public.voiceops_calls;
DROP POLICY IF EXISTS "Users can delete own voiceops calls" ON public.voiceops_calls;

CREATE POLICY "Users can view own voiceops calls" ON public.voiceops_calls FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own voiceops calls" ON public.voiceops_calls FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own voiceops calls" ON public.voiceops_calls FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own voiceops calls" ON public.voiceops_calls FOR DELETE USING (auth.uid() = user_id);