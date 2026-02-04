-- Fix overly permissive RLS policy - drop and recreate with proper service role check
DROP POLICY IF EXISTS "Service role full access" ON public.order_emails;