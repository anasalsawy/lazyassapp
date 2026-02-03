import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface PipelineStatus {
  running: boolean;
  step: string;
  progress: number;
  result?: {
    atsScore?: number;
    skills?: number;
    jobsFound?: number;
    applications?: number;
  };
}

export const useAutoPipeline = () => {
  const { session } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<PipelineStatus>({
    running: false,
    step: "idle",
    progress: 0,
  });

  const triggerPipeline = useCallback(async (resumeId: string, resumeText: string) => {
    if (!session?.access_token) {
      toast({ title: "Please sign in", variant: "destructive" });
      return null;
    }

    setStatus({ running: true, step: "Starting pipeline...", progress: 5 });

    toast({
      title: "🚀 Auto-Apply Pipeline Started",
      description: "Sit back! Analyzing resume, finding jobs, and applying automatically...",
    });

    try {
      // Simulate progress updates while waiting
      const progressInterval = setInterval(() => {
        setStatus(prev => {
          if (prev.progress < 90) {
            const steps = [
              { progress: 10, step: "📄 Analyzing your resume..." },
              { progress: 25, step: "⚙️ Updating job preferences..." },
              { progress: 40, step: "🔍 Searching for matching jobs..." },
              { progress: 60, step: "🎯 Scoring job matches..." },
              { progress: 75, step: "✍️ Generating cover letters..." },
              { progress: 85, step: "🤖 Submitting applications..." },
            ];
            const nextStep = steps.find(s => s.progress > prev.progress);
            if (nextStep) {
              return { ...prev, step: nextStep.step, progress: nextStep.progress };
            }
            return { ...prev, progress: prev.progress + 2 };
          }
          return prev;
        });
      }, 2000);

      const { data, error } = await supabase.functions.invoke("auto-pipeline", {
        body: {
          trigger: "resume_upload",
          resumeId,
          resumeText,
        },
      });

      clearInterval(progressInterval);

      if (error) throw error;

      if (data.success) {
        setStatus({
          running: false,
          step: "Complete!",
          progress: 100,
          result: data.summary,
        });

        toast({
          title: "✅ Pipeline Complete!",
          description: `Found ${data.summary?.jobsFound || 0} jobs, submitted ${data.summary?.applications || 0} applications!`,
        });

        return data;
      } else {
        throw new Error(data.error || "Pipeline failed");
      }
    } catch (error: any) {
      console.error("Pipeline error:", error);
      setStatus({ running: false, step: "Failed", progress: 0 });
      toast({
        title: "Pipeline Failed",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
      return null;
    }
  }, [session, toast]);

  const resetStatus = useCallback(() => {
    setStatus({ running: false, step: "idle", progress: 0 });
  }, []);

  return {
    status,
    triggerPipeline,
    resetStatus,
    isRunning: status.running,
  };
};
