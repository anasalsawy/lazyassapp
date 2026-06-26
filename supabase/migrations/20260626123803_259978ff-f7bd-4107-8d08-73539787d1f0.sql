UPDATE public.voiceops_calls
SET status='queued', next_retry_at=now(), retry_enabled=true
WHERE user_id='4290e536-8ddc-4ffa-b322-49eb88a67114'
  AND status='failed'
  AND created_at > now() - interval '4 hours';