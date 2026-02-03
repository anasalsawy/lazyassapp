-- Create table for storing encrypted billing/card details
CREATE TABLE public.payment_cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  card_name TEXT NOT NULL,
  card_number_enc TEXT NOT NULL,
  expiry_enc TEXT NOT NULL,
  cvv_enc TEXT NOT NULL,
  cardholder_name TEXT NOT NULL,
  billing_address TEXT,
  billing_city TEXT,
  billing_state TEXT,
  billing_zip TEXT,
  billing_country TEXT DEFAULT 'US',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for shipping addresses
CREATE TABLE public.shipping_addresses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  address_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  country TEXT DEFAULT 'US',
  phone TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for shopping orders/requests
CREATE TABLE public.auto_shop_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_query TEXT NOT NULL,
  max_price NUMERIC,
  quantity INTEGER DEFAULT 1,
  shipping_address_id UUID REFERENCES public.shipping_addresses(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'searching', 'found_deals', 'ordering', 'completed', 'failed', 'cancelled')),
  selected_deal_url TEXT,
  selected_deal_price NUMERIC,
  selected_deal_site TEXT,
  order_confirmation TEXT,
  cards_tried UUID[] DEFAULT '{}',
  sites_tried TEXT[] DEFAULT '{}',
  browser_use_task_id TEXT,
  error_message TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS on all tables
ALTER TABLE public.payment_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_shop_orders ENABLE ROW LEVEL SECURITY;

-- RLS policies for payment_cards
CREATE POLICY "Users can view own cards" ON public.payment_cards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cards" ON public.payment_cards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cards" ON public.payment_cards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cards" ON public.payment_cards FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for shipping_addresses
CREATE POLICY "Users can view own addresses" ON public.shipping_addresses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own addresses" ON public.shipping_addresses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own addresses" ON public.shipping_addresses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own addresses" ON public.shipping_addresses FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for auto_shop_orders
CREATE POLICY "Users can view own orders" ON public.auto_shop_orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own orders" ON public.auto_shop_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own orders" ON public.auto_shop_orders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own orders" ON public.auto_shop_orders FOR DELETE USING (auth.uid() = user_id);

-- Update trigger for updated_at
CREATE TRIGGER update_payment_cards_updated_at BEFORE UPDATE ON public.payment_cards FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_shipping_addresses_updated_at BEFORE UPDATE ON public.shipping_addresses FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_auto_shop_orders_updated_at BEFORE UPDATE ON public.auto_shop_orders FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();