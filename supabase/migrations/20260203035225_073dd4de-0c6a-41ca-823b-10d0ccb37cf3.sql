-- Fix job upsert conflicts: ensure a matching unique constraint exists
-- 1) Remove duplicates that would block a new unique constraint
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, external_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.jobs
  WHERE external_id IS NOT NULL
)
DELETE FROM public.jobs j
USING ranked r
WHERE j.id = r.id
  AND r.rn > 1;

-- 2) Drop any previous partial index that does not satisfy ON CONFLICT requirements
DROP INDEX IF EXISTS public.jobs_external_id_unique;
DROP INDEX IF EXISTS public.jobs_external_id_unique_idx;

-- 3) Create a proper unique index for ON CONFLICT (user_id, external_id)
CREATE UNIQUE INDEX IF NOT EXISTS jobs_user_id_external_id_unique
ON public.jobs (user_id, external_id);
