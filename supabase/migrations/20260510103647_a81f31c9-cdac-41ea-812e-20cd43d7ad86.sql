
CREATE TABLE public.voiceops_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vapi_call_id text UNIQUE,
  control_url text,
  phone_number text NOT NULL,
  objective text NOT NULL,
  customer_info jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  outcome text,
  recording_url text,
  cost_usd numeric,
  duration_seconds integer,
  ended_reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.voiceops_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.voiceops_calls(id) ON DELETE CASCADE,
  role text NOT NULL,
  text text NOT NULL,
  is_final boolean NOT NULL DEFAULT true,
  seq integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.voiceops_injections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.voiceops_calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  text text NOT NULL,
  mode text NOT NULL DEFAULT 'context',
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX idx_voiceops_calls_user ON public.voiceops_calls(user_id, created_at DESC);
CREATE INDEX idx_voiceops_transcripts_call ON public.voiceops_transcripts(call_id, created_at);
CREATE INDEX idx_voiceops_injections_call ON public.voiceops_injections(call_id, created_at);

ALTER TABLE public.voiceops_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voiceops_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voiceops_injections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners view own voiceops calls" ON public.voiceops_calls
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.get_owner_id(auth.uid()) = user_id
  );

CREATE POLICY "owners manage own voiceops calls" ON public.voiceops_calls
  FOR ALL USING (
    auth.uid() = user_id
    OR public.get_owner_id(auth.uid()) = user_id
  ) WITH CHECK (
    auth.uid() = user_id
    OR public.get_owner_id(auth.uid()) = user_id
  );

CREATE POLICY "view transcripts for accessible calls" ON public.voiceops_transcripts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.voiceops_calls c
      WHERE c.id = voiceops_transcripts.call_id
        AND (auth.uid() = c.user_id OR public.get_owner_id(auth.uid()) = c.user_id)
    )
  );

CREATE POLICY "view injections for accessible calls" ON public.voiceops_injections
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.voiceops_calls c
      WHERE c.id = voiceops_injections.call_id
        AND (auth.uid() = c.user_id OR public.get_owner_id(auth.uid()) = c.user_id)
    )
  );

CREATE POLICY "create injections for accessible calls" ON public.voiceops_injections
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.voiceops_calls c
      WHERE c.id = call_id
        AND (auth.uid() = c.user_id OR public.get_owner_id(auth.uid()) = c.user_id)
    )
  );

CREATE TRIGGER voiceops_calls_updated_at
  BEFORE UPDATE ON public.voiceops_calls
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.voiceops_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voiceops_transcripts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voiceops_injections;
