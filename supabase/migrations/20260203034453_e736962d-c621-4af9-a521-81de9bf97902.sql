-- Create unique index on external_id for job upsert operations
-- Use a partial index to only include non-null values
CREATE UNIQUE INDEX IF NOT EXISTS jobs_external_id_unique 
ON public.jobs (external_id) 
WHERE external_id IS NOT NULL;