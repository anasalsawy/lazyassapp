
CREATE TABLE IF NOT EXISTS public.voiceops_callers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  phone_number text NOT NULL UNIQUE,
  name text,
  email text,
  tags text[] DEFAULT '{}',
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  last_call_at timestamptz,
  call_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.voiceops_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  caller_id uuid REFERENCES public.voiceops_callers(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  customer_name text,
  party_size integer,
  reservation_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  vapi_call_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.voiceops_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  caller_id uuid REFERENCES public.voiceops_callers(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  customer_name text,
  booking_type text NOT NULL,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  details jsonb DEFAULT '{}'::jsonb,
  notes text,
  vapi_call_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voiceops_callers_phone ON public.voiceops_callers(phone_number);
CREATE INDEX IF NOT EXISTS idx_voiceops_reservations_phone ON public.voiceops_reservations(phone_number);
CREATE INDEX IF NOT EXISTS idx_voiceops_reservations_status ON public.voiceops_reservations(status);
CREATE INDEX IF NOT EXISTS idx_voiceops_bookings_phone ON public.voiceops_bookings(phone_number);
CREATE INDEX IF NOT EXISTS idx_voiceops_bookings_status ON public.voiceops_bookings(status);

ALTER TABLE public.voiceops_callers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voiceops_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voiceops_bookings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view all (single-tenant ops console). Edge function uses service role to write.
CREATE POLICY "Authenticated can view callers" ON public.voiceops_callers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can update callers" ON public.voiceops_callers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can insert callers" ON public.voiceops_callers FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can view reservations" ON public.voiceops_reservations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can update reservations" ON public.voiceops_reservations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can insert reservations" ON public.voiceops_reservations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can delete reservations" ON public.voiceops_reservations FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated can view bookings" ON public.voiceops_bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can update bookings" ON public.voiceops_bookings FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can insert bookings" ON public.voiceops_bookings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can delete bookings" ON public.voiceops_bookings FOR DELETE TO authenticated USING (true);

CREATE TRIGGER voiceops_callers_updated_at BEFORE UPDATE ON public.voiceops_callers FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER voiceops_reservations_updated_at BEFORE UPDATE ON public.voiceops_reservations FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER voiceops_bookings_updated_at BEFORE UPDATE ON public.voiceops_bookings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
