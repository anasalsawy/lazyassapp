import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export type WebAgentStatus = "idle" | "starting" | "running" | "completed" | "failed";

interface WebAgentJob {
  sessionId: string;
  taskId: string;
  applicationId: string;
  jobTitle: string;
  company: string;
  status: WebAgentStatus;
  message?: string;
  error?: string;
  steps?: Array<{ action: string; timestamp: string }>;
  screenshots?: string[];
}

interface ApplyOptions {
  jobId: string;
  jobUrl: string;
  jobTitle: string;
  company: string;
  resumeData?: {
    skills: string[];
    experience_years: number;
    parsed_content: any;
  };
  coverLetter?: string;
  userProfile: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    linkedin?: string;
  };
}

export const useWebAgentApply = () => {
  const { session } = useAuth();
  const { toast } = useToast();
  const [activeJobs, setActiveJobs] = useState<WebAgentJob[]>([]);
  const [loading, setLoading] = useState(false);

  const startApplication = useCallback(async (options: ApplyOptions): Promise<WebAgentJob | null> => {
    if (!session?.access_token) {
      toast({ title: "Please sign in", variant: "destructive" });
      return null;
    }

    if (!options.jobUrl) {
      toast({ 
        title: "Cannot use AI Agent", 
        description: "This job doesn't have a URL. Use Quick Apply instead.",
        variant: "destructive" 
      });
      return null;
    }

    setLoading(true);

    try {
      toast({
        title: "🤖 AI Web Agent Starting",
        description: `Navigating to ${options.company} to submit your application...`,
      });

      const { data, error } = await supabase.functions.invoke("web-agent-apply", {
        body: options,
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || "Failed to start web agent");
      }

      const newJob: WebAgentJob = {
        sessionId: data.sessionId,
        taskId: data.taskId,
        applicationId: data.applicationId,
        jobTitle: options.jobTitle,
        company: options.company,
        status: "running",
        message: data.message,
      };

      setActiveJobs(prev => [...prev, newJob]);

      toast({
        title: "🚀 Application In Progress",
        description: `AI agent is filling out your application at ${options.company}. This takes 1-3 minutes.`,
      });

      // Start polling for status
      pollStatus(newJob);

      return newJob;
    } catch (error: any) {
      console.error("Web agent error:", error);
      toast({
        title: "AI Agent Failed",
        description: error.message || "Failed to start automated application",
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [session, toast]);

  const pollStatus = useCallback(async (job: WebAgentJob) => {
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        updateJobStatus(job.sessionId, "failed", "Timeout: Application took too long");
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("web-agent-status", {
          body: {
            sessionId: job.sessionId,
            taskId: job.taskId,
            applicationId: job.applicationId,
          },
        });

        if (error) throw error;

        const status = data.status as WebAgentStatus;
        
        updateJobStatus(job.sessionId, status, data.finalMessage, data.error, data.steps, data.screenshots);

        if (status === "completed") {
          toast({
            title: "✅ Application Submitted!",
            description: `Successfully applied to ${job.jobTitle} at ${job.company}`,
          });
          return;
        }

        if (status === "failed") {
          toast({
            title: "❌ Application Failed",
            description: data.error || `Could not complete application at ${job.company}`,
            variant: "destructive",
          });
          return;
        }

        // Still running, poll again
        attempts++;
        setTimeout(poll, 5000);
      } catch (error) {
        console.error("Status poll error:", error);
        attempts++;
        setTimeout(poll, 5000);
      }
    };

    // Start polling after a short delay
    setTimeout(poll, 3000);
  }, [toast]);

  const updateJobStatus = useCallback((
    sessionId: string, 
    status: WebAgentStatus, 
    message?: string,
    error?: string,
    steps?: Array<{ action: string; timestamp: string }>,
    screenshots?: string[]
  ) => {
    setActiveJobs(prev => prev.map(job => 
      job.sessionId === sessionId 
        ? { ...job, status, message, error, steps, screenshots }
        : job
    ));
  }, []);

  const clearCompletedJobs = useCallback(() => {
    setActiveJobs(prev => prev.filter(job => job.status === "running" || job.status === "starting"));
  }, []);

  const getJobBySessionId = useCallback((sessionId: string) => {
    return activeJobs.find(job => job.sessionId === sessionId);
  }, [activeJobs]);

  return {
    loading,
    activeJobs,
    startApplication,
    clearCompletedJobs,
    getJobBySessionId,
    hasActiveJobs: activeJobs.some(job => job.status === "running" || job.status === "starting"),
  };
};
