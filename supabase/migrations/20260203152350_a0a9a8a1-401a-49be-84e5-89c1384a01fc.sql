-- Add shop profile tracking to browser_profiles table
ALTER TABLE public.browser_profiles
ADD COLUMN IF NOT EXISTS shop_sites_logged_in TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS shop_pending_login_site TEXT,
ADD COLUMN IF NOT EXISTS shop_pending_task_id TEXT,
ADD COLUMN IF NOT EXISTS shop_pending_session_id TEXT;

-- Create table for tracking order shipments from email
CREATE TABLE IF NOT EXISTS public.order_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  order_id UUID REFERENCES public.auto_shop_orders(id) ON DELETE CASCADE,
  carrier TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_update TEXT,
  estimated_delivery DATE,
  email_source TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.order_tracking ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own tracking" ON public.order_tracking
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tracking" ON public.order_tracking
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tracking" ON public.order_tracking
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tracking" ON public.order_tracking
  FOR DELETE USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_order_tracking_updated_at
  BEFORE UPDATE ON public.order_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();