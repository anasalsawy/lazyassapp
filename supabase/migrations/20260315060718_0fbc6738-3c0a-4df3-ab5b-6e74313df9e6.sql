ALTER TABLE public.agent_tasks
ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'FAST'
CHECK (mode IN ('FAST', 'CONTROL'));

UPDATE public.agent_tasks
SET mode = 'FAST'
WHERE mode IS NULL;