
-- VM instances table for managing Windows 11 VMs
CREATE TABLE public.vm_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL DEFAULT 'admin',
  ssh_key_enc TEXT,
  ssh_password_enc TEXT,
  vnc_url TEXT,
  noVNC_url TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  os TEXT NOT NULL DEFAULT 'windows_11',
  specs_json JSONB DEFAULT '{}'::jsonb,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vm_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own VMs" ON public.vm_instances FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own VMs" ON public.vm_instances FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own VMs" ON public.vm_instances FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own VMs" ON public.vm_instances FOR DELETE USING (auth.uid() = user_id);

-- VM command logs for audit trail
CREATE TABLE public.vm_command_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  vm_id UUID NOT NULL REFERENCES public.vm_instances(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  output TEXT,
  exit_code INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vm_command_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own VM logs" ON public.vm_command_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own VM logs" ON public.vm_command_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
