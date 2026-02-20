import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

interface BrowserProfile {
  hasProfile: boolean;
  sitesLoggedIn: string[];
  lastLoginAt: string | null;
  status: string;
}

interface AgentRun {
  id: string;
  run_type: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  summary_json: any;
}

interface Job {
  id: string;
  title: string;
  company: string;
  location: string | null;
  match_score: number | null;
  url: string | null;
  created_at: string;
}

interface Application {
  id: string;
  status: string;
  created_at: string;
  jobs: Job;
}

export function useJobAgent() {
  const { user, session } = useAuth();
  const [profile, setProfile] = useState<BrowserProfile | null>(null);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [recentApplications, setRecentApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [loginSession, setLoginSession] = useState<{
    sessionId: string;
    taskId: string;
    liveViewUrl: string;
    site: string;
  } | null>(null);

  const callAgent = useCallback(async (action: string, body: any = {}) => {
    if (!session?.access_token) {
      toast.error("Please sign in");
      return null;
    }

    try {
      const { data, error } = await supabase.functions.invoke("job-agent", {
        body: { action, ...body },
      });

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error("[JobAgent]", error);
      toast.error(error.message || "Agent error");
      return null;
    }
  }, [session?.access_token]);

  // Fetch status on mount
  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    const data = await callAgent("get_status");
    if (data) {
      setProfile(data.profile);
      setRecentRuns(data.recentRuns || []);
      setRecentJobs(data.recentJobs || []);
      setRecentApplications(data.recentApplications || []);
    }
    setIsLoading(false);
  }, [callAgent]);

  useEffect(() => {
    if (user) {
      fetchStatus();
    }
  }, [user, fetchStatus]);

  // Create browser profile
  const createProfile = useCallback(async () => {
    toast.info("Creating browser profile...");
    const data = await callAgent("create_profile");
    if (data?.success) {
      toast.success("Profile created!");
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

  // Start login session
  const startLogin = useCallback(async (site: string) => {
    toast.info(`Opening ${site} for login...`);
    const data = await callAgent("start_login", { site });
    if (data?.success) {
      setLoginSession({
        sessionId: data.sessionId,
        taskId: data.taskId,
        liveViewUrl: data.liveViewUrl,
        site: data.site,
      });
      toast.success("Browser opened! Log in to your account.");
    }
    return data;
  }, [callAgent]);

  // Confirm login
  const confirmLogin = useCallback(async (site: string) => {
    const data = await callAgent("confirm_login", { site });
    if (data?.success) {
      toast.success(`${site} connected!`);
      setLoginSession(null);
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

  // Run the agent - returns immediately, pipeline runs in background
  const runAgent = useCallback(async () => {
    setIsRunning(true);
    toast.info("🤖 Starting job agent pipeline...");
    
    const data = await callAgent("run_agent");
    
    if (data?.success) {
      toast.success("🚀 Pipeline started! Jobs will appear as they're discovered. Refresh in a few minutes.", {
        duration: 6000,
      });
      
      // Poll for completion in background
      if (data.runId) {
        const pollInterval = setInterval(async () => {
          const { data: run } = await supabase
            .from("agent_runs")
            .select("*")
            .eq("id", data.runId)
            .single();
          
          if (run?.status === "completed") {
            clearInterval(pollInterval);
            const summary = run.summary_json as any;
            toast.success(
              `✅ Pipeline complete! Found ${summary?.jobsFound || 0} jobs, ${summary?.jobsQualified || 0} qualified, ${summary?.submittedToSkyvern || 0} submitted.`,
              { duration: 8000 }
            );
            fetchStatus();
          } else if (run?.status === "failed") {
            clearInterval(pollInterval);
            toast.error("Pipeline failed. Check the Agent Runs tab for details.");
            fetchStatus();
          }
        }, 5000);
        
        // Stop polling after 10 minutes max
        setTimeout(() => clearInterval(pollInterval), 600_000);
      }
    }
    
    setIsRunning(false);
    return data;
  }, [callAgent, fetchStatus]);

  return {
    profile,
    recentRuns,
    recentJobs,
    recentApplications,
    isLoading,
    isRunning,
    loginSession,
    createProfile,
    startLogin,
    confirmLogin,
    runAgent,
    refetch: fetchStatus,
  };
}
