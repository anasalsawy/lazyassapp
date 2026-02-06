import { useState, useEffect, useCallback, useRef } from "react";
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

interface ResearchStatus {
  runId: string;
  status: "running" | "completed" | "failed";
  stepCount?: number;
  jobsFound?: number;
  jobsStored?: number;
  researchSummary?: string;
  candidateAnalysis?: string;
  marketInsights?: string;
  message?: string;
}

export function useJobAgent() {
  const { user, session } = useAuth();
  const [profile, setProfile] = useState<BrowserProfile | null>(null);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [recentApplications, setRecentApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | null>(null);
  const [loginSession, setLoginSession] = useState<{
    sessionId: string;
    taskId: string;
    liveViewUrl: string;
    site: string;
  } | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const callAgent = useCallback(
    async (action: string, body: any = {}) => {
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
    },
    [session?.access_token]
  );

  // Fetch status on mount
  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    const data = await callAgent("get_status");
    if (data) {
      setProfile(data.profile);
      setRecentRuns(data.recentRuns || []);
      setRecentJobs(data.recentJobs || []);
      setRecentApplications(data.recentApplications || []);

      // Resume polling if there's an active research
      if (data.activeResearch?.status === "running") {
        startPolling(data.activeResearch.runId);
      }
    }
    setIsLoading(false);
  }, [callAgent]);

  useEffect(() => {
    if (user) fetchStatus();
  }, [user, fetchStatus]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

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
  const startLogin = useCallback(
    async (site: string) => {
      toast.info(`Opening ${site} for login...`);
      const data = await callAgent("start_login", { site });
      if (data?.success) {
        setLoginSession({
          sessionId: data.sessionId,
          taskId: data.taskId || "",
          liveViewUrl: data.liveViewUrl,
          site: data.site,
        });
        toast.success("Browser opened! Log in to your account.");
      }
      return data;
    },
    [callAgent]
  );

  // Confirm login
  const confirmLogin = useCallback(
    async (site: string) => {
      const data = await callAgent("confirm_login", { site });
      if (data?.success) {
        toast.success(`${site} connected!`);
        setLoginSession(null);
        fetchStatus();
      }
      return data;
    },
    [callAgent, fetchStatus]
  );

  // ★ Deep Research — the core pipeline
  const startPolling = useCallback(
    (runId: string) => {
      // Clear any existing poll
      if (pollingRef.current) clearInterval(pollingRef.current);

      setResearchStatus({ runId, status: "running", message: "Deep Research in progress..." });
      setIsRunning(true);

      pollingRef.current = setInterval(async () => {
        const data = await callAgent("check_research", { runId });
        if (!data) return;

        if (data.status === "running") {
          setResearchStatus({
            runId,
            status: "running",
            stepCount: data.stepCount,
            message: data.message,
          });
        } else if (data.status === "completed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setIsRunning(false);
          setResearchStatus({
            runId,
            status: "completed",
            jobsFound: data.jobsFound,
            jobsStored: data.jobsStored,
            researchSummary: data.researchSummary,
            candidateAnalysis: data.candidateAnalysis,
            marketInsights: data.marketInsights,
            message: data.message,
          });
          toast.success(`Deep Research complete! Found ${data.jobsFound} matched jobs.`);
          fetchStatus(); // Refresh jobs list
        } else {
          // failed
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setIsRunning(false);
          setResearchStatus({
            runId,
            status: "failed",
            message: data.message || "Research failed",
          });
          toast.error("Deep Research encountered an issue. Please try again.");
        }
      }, 15000); // Poll every 15 seconds — Deep Research takes minutes
    },
    [callAgent, fetchStatus]
  );

  const runDeepResearch = useCallback(async () => {
    setIsRunning(true);
    toast.info("🔬 Launching ChatGPT Deep Research...");
    const data = await callAgent("deep_research_jobs");

    if (data?.success) {
      toast.success("Deep Research is running. This takes 5-10 minutes.");
      startPolling(data.runId);
    } else {
      setIsRunning(false);
    }
    return data;
  }, [callAgent, startPolling]);

  // Cleanup sessions
  const cleanupSessions = useCallback(async () => {
    const data = await callAgent("cleanup_sessions");
    if (data?.success) {
      toast.success(data.message);
    }
    return data;
  }, [callAgent]);

  return {
    profile,
    recentRuns,
    recentJobs,
    recentApplications,
    isLoading,
    isRunning,
    researchStatus,
    loginSession,
    createProfile,
    startLogin,
    confirmLogin,
    runDeepResearch,
    cleanupSessions,
    refetch: fetchStatus,
  };
}
