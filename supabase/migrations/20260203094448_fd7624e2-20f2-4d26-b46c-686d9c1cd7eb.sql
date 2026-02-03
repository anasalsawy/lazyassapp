-- Drop existing check constraint
ALTER TABLE public.applications DROP CONSTRAINT applications_status_check;

-- Add new check constraint with all required statuses
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check 
CHECK (status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'applied'::text, 'under_review'::text, 'interview'::text, 'offer'::text, 'rejected'::text, 'withdrawn'::text, 'failed'::text]));