-- Step 2: Update existing status values to match new enum
UPDATE public.applications 
SET status = CASE 
    WHEN status = 'under_review' THEN 'in-review'
    WHEN status = 'withdrawn' THEN 'rejected'
    WHEN status NOT IN ('pending-apply', 'applying', 'applied', 'in-review', 'interview', 'offer', 'rejected', 'error', 'needs-user-action') THEN 'applied'
    ELSE status
END
WHERE status NOT IN ('pending-apply', 'applying', 'applied', 'in-review', 'interview', 'offer', 'rejected', 'error', 'needs-user-action');

-- Step 3: Add the check constraint
ALTER TABLE public.applications 
DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE public.applications
ADD CONSTRAINT applications_status_check 
CHECK (status IN ('pending-apply', 'applying', 'applied', 'in-review', 'interview', 'offer', 'rejected', 'error', 'needs-user-action'));

-- Step 4: Add indexes
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_platform ON public.applications(platform);
CREATE INDEX IF NOT EXISTS idx_applications_user_status ON public.applications(user_id, status);

-- Step 5: Add platform column to jobs
ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS platform text DEFAULT 'other';

-- Step 6: Create tracking_runs table
CREATE TABLE IF NOT EXISTS public.tracking_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    started_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    status text DEFAULT 'running',
    platforms_checked text[] DEFAULT '{}',
    applications_updated integer DEFAULT 0,
    error_message text,
    created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tracking_runs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own tracking runs"
ON public.tracking_runs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tracking runs"
ON public.tracking_runs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tracking runs"
ON public.tracking_runs FOR UPDATE
USING (auth.uid() = user_id);