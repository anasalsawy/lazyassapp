
-- Add retry tracking columns to auto_shop_orders
ALTER TABLE public.auto_shop_orders
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS failure_analysis text,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamp with time zone;
