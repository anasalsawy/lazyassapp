
-- Fix: drop the overly broad "Service role full access" policy and keep user-scoped ones
DROP POLICY "Service role full access" ON public.user_credits;
