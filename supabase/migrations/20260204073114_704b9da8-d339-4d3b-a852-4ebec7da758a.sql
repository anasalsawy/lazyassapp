-- Create table for storing all order-related emails from Gmail
CREATE TABLE public.order_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  order_id UUID REFERENCES public.auto_shop_orders(id) ON DELETE SET NULL,
  gmail_message_id TEXT NOT NULL,
  thread_id TEXT,
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT,
  subject TEXT NOT NULL,
  snippet TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_read BOOLEAN DEFAULT false,
  email_type TEXT DEFAULT 'other', -- confirmation, shipping, tracking, reply, promotion, other
  extracted_data JSONB DEFAULT '{}'::jsonb, -- tracking numbers, order IDs, etc.
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, gmail_message_id)
);

-- Enable RLS
ALTER TABLE public.order_emails ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own order emails"
  ON public.order_emails FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own order emails"
  ON public.order_emails FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own order emails"
  ON public.order_emails FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own order emails"
  ON public.order_emails FOR DELETE
  USING (auth.uid() = user_id);

-- Service role policy for edge functions
CREATE POLICY "Service role full access"
  ON public.order_emails FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add updated_at trigger
CREATE TRIGGER update_order_emails_updated_at
  BEFORE UPDATE ON public.order_emails
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Index for faster queries
CREATE INDEX idx_order_emails_user_id ON public.order_emails(user_id);
CREATE INDEX idx_order_emails_order_id ON public.order_emails(order_id);
CREATE INDEX idx_order_emails_received_at ON public.order_emails(received_at DESC);