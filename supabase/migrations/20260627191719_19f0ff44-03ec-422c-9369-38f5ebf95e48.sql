
CREATE TABLE public.travel_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  duffel_order_id TEXT UNIQUE,
  booking_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  total_amount NUMERIC,
  total_currency TEXT,
  passengers JSONB DEFAULT '[]'::jsonb,
  slices JSONB DEFAULT '[]'::jsonb,
  services JSONB DEFAULT '[]'::jsonb,
  payment_status TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.travel_orders TO authenticated;
GRANT ALL ON public.travel_orders TO service_role;
ALTER TABLE public.travel_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own travel orders" ON public.travel_orders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER travel_orders_updated BEFORE UPDATE ON public.travel_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_travel_orders_user ON public.travel_orders(user_id, created_at DESC);
