import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

interface AccountConnection {
  id: string;
  site_key: string;
  status: "connected" | "expired" | "needs_mfa" | "needs_captcha" | "error" | "disconnected";
  username_hint: string | null;
  last_validated_at: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

interface AgentTask {
  id: string;
  task_type: string;
  status: "open" | "resolved" | "expired";
  payload: Record<string, unknown>;
  created_at: string;
}

const SUPPORTED_SITES = {
  ats: [
    { key: "greenhouse", name: "Greenhouse", icon: "🌿" },
    { key: "lever", name: "Lever", icon: "⚡" },
    { key: "workday", name: "Workday", icon: "💼" },
    { key: "icims", name: "iCIMS", icon: "📋" },
    { key: "smartrecruiters", name: "SmartRecruiters", icon: "🎯" },
    { key: "ashby", name: "Ashby", icon: "🔮" },
  ],
  job_boards: [
    { key: "linkedin", name: "LinkedIn", icon: "💼" },
    { key: "indeed", name: "Indeed", icon: "🔍" },
    { key: "glassdoor", name: "Glassdoor", icon: "🚪" },
    { key: "ziprecruiter", name: "ZipRecruiter", icon: "⚡" },
  ],
};

export function useAccountAgent() {
  const { user, session } = useAuth();
  const [connections, setConnections] = useState<AccountConnection[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState<string | null>(null);

  // Fetch connections
  const fetchConnections = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("account_connections")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setConnections((data as AccountConnection[]) || []);
    } catch (error) {
      console.error("Failed to fetch connections:", error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Fetch agent tasks
  const fetchAgentTasks = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("agent_tasks")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "open")
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      setAgentTasks(
        (data || []).map((t) => ({
          id: t.id,
          task_type: t.task_type,
          status: t.status as "open" | "resolved" | "expired",
          payload: (t.payload as Record<string, unknown>) || {},
          created_at: t.created_at || new Date().toISOString(),
        }))
      );
    } catch (error) {
      console.error("Failed to fetch agent tasks:", error);
    }
  }, [user]);

  // Start connect flow (placeholder - would integrate with Browser Use)
  const startConnect = useCallback(async (siteKey: string) => {
    if (!session?.access_token || !user) {
      toast.error("Please sign in first");
      return;
    }

    setIsConnecting(siteKey);

    try {
      // In production, this would:
      // 1. Start a Browser Use session
      // 2. Navigate to the site's login page
      // 3. Wait for user to log in
      // 4. Capture session cookies
      // 5. Store encrypted session

      // For now, create a placeholder connection
      const { error } = await supabase.from("account_connections").upsert(
        {
          user_id: user.id,
          site_key: siteKey,
          status: "connected",
          username_hint: "user@example.com",
          last_validated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,site_key" }
      );

      if (error) throw error;

      toast.success(`Connected to ${siteKey}`);
      fetchConnections();
    } catch (error) {
      console.error("Connect error:", error);
      toast.error("Failed to connect account");
    } finally {
      setIsConnecting(null);
    }
  }, [session?.access_token, user, fetchConnections]);

  // Test session
  const testSession = useCallback(async (connectionId: string) => {
    if (!session?.access_token) return;

    setIsTesting(connectionId);

    try {
      // In production, this would:
      // 1. Start a Browser Use session with stored cookies
      // 2. Navigate to the site
      // 3. Check if still logged in
      // 4. Update status accordingly

      // Simulate test
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const { error } = await supabase
        .from("account_connections")
        .update({
          last_validated_at: new Date().toISOString(),
          status: "connected",
        })
        .eq("id", connectionId);

      if (error) throw error;

      toast.success("Session is valid!");
      fetchConnections();
    } catch (error) {
      console.error("Test error:", error);
      toast.error("Session test failed");
    } finally {
      setIsTesting(null);
    }
  }, [session?.access_token, fetchConnections]);

  // Disconnect
  const disconnect = useCallback(async (connectionId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("account_connections")
        .update({
          status: "disconnected",
          session_blob_enc: null,
        })
        .eq("id", connectionId);

      if (error) throw error;

      toast.success("Account disconnected");
      fetchConnections();
    } catch (error) {
      console.error("Disconnect error:", error);
      toast.error("Failed to disconnect");
    }
  }, [user, fetchConnections]);

  // Resolve task (submit MFA code, etc.)
  const resolveTask = useCallback(async (taskId: string, resolution: Record<string, unknown>) => {
    if (!session?.access_token) return;

    try {
      const { error } = await supabase
        .from("agent_tasks")
        .update({
          status: "resolved",
          result: resolution as unknown as import("@/integrations/supabase/types").Json,
        })
        .eq("id", taskId);

      if (error) throw error;

      toast.success("Task resolved");
      fetchAgentTasks();
    } catch (error) {
      console.error("Resolve error:", error);
      toast.error("Failed to resolve task");
    }
  }, [session?.access_token, fetchAgentTasks]);

  // Initial fetch
  useEffect(() => {
    if (user) {
      fetchConnections();
      fetchAgentTasks();
    }
  }, [user, fetchConnections, fetchAgentTasks]);

  return {
    connections,
    agentTasks,
    supportedSites: SUPPORTED_SITES,
    isLoading,
    isConnecting,
    isTesting,
    startConnect,
    testSession,
    disconnect,
    resolveTask,
    refetch: fetchConnections,
    refetchTasks: fetchAgentTasks,
  };
}
