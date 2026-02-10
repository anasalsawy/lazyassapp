import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface Scorecard {
  overall_score: number;
  ats_score: number;
  keyword_coverage_score: number;
  clarity_score: number;
  truth_violations: string[];
  missing_sections: string[];
  missing_keyword_clusters: string[];
  required_edits: Array<{
    type: string;
    location: string;
    before: string;
    after: string;
  }>;
  must_fix_before_next_round: string[];
  praise: string[];
}

export interface OptimizationResult {
  checklist: any;
  scorecard: Scorecard;
  ats_text: string;
  pretty_md: string;
  changelog: string;
  html: string;
  rounds_completed: number;
  target_role: string;
  location: string;
  optimized_at: string;
}

export interface GatekeeperVerdict {
  step: string;
  passed: boolean;
  blocking_issues?: string[];
  evidence?: string[];
  next_step?: string;
  forced?: boolean;
  retry?: number;
}

export interface OptimizationProgress {
  step: string;
  round?: number;
  message: string;
  scorecard?: Scorecard;
  checklist?: any;
  gatekeeper?: GatekeeperVerdict;
}

export interface ManualPause {
  step: string;
  next_step: string;
  continuation_id: string;
  message: string;
}

type OptimizerStatus = "idle" | "running" | "complete" | "error" | "awaiting_continue";

export function useResumeOptimizer() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<OptimizerStatus>("idle");
  const [progress, setProgress] = useState<OptimizationProgress[]>([]);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [currentRound, setCurrentRound] = useState<number>(0);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [latestScorecard, setLatestScorecard] = useState<Scorecard | null>(null);
  const [gatekeeperVerdicts, setGatekeeperVerdicts] = useState<GatekeeperVerdict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualPause, setManualPause] = useState<ManualPause | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Store resumeId for continue calls
  const resumeIdRef = useRef<string>("");

  const processSSEStream = useCallback(
    async (response: Response) => {
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);

          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const event = JSON.parse(jsonStr);

            switch (event.type) {
              case "progress":
                setCurrentStep(event.step || "");
                if (event.round) setCurrentRound(event.round);
                setProgress((prev) => [
                  ...prev,
                  { step: event.step, round: event.round, message: event.message },
                ]);
                break;

              case "researcher_done":
                setCurrentStep("researcher_done");
                setProgress((prev) => [
                  ...prev,
                  { step: "researcher_done", message: event.message, checklist: event.checklist },
                ]);
                break;

              case "writer_done":
                setCurrentStep("writer_done");
                if (event.round) setCurrentRound(event.round);
                setProgress((prev) => [
                  ...prev,
                  { step: "writer_done", round: event.round, message: event.message },
                ]);
                break;

              case "critic_done":
                setCurrentStep("critic_done");
                if (event.scorecard) setLatestScorecard(event.scorecard);
                setProgress((prev) => [
                  ...prev,
                  { step: "critic_done", round: event.round, message: event.message, scorecard: event.scorecard },
                ]);
                break;

              case "designer_done":
                setCurrentStep("designer_done");
                setProgress((prev) => [
                  ...prev,
                  { step: "designer_done", message: event.message },
                ]);
                break;

              case "gatekeeper_pass":
                setCurrentStep("gatekeeper_pass");
                {
                  const verdict: GatekeeperVerdict = {
                    step: event.step,
                    passed: true,
                    evidence: event.evidence,
                    next_step: event.next_step,
                  };
                  setGatekeeperVerdicts((prev) => [...prev, verdict]);
                  setProgress((prev) => [
                    ...prev,
                    { step: "gatekeeper_pass", message: event.message, gatekeeper: verdict },
                  ]);
                }
                break;

              case "gatekeeper_fail":
                setCurrentStep("gatekeeper_fail");
                {
                  const verdict: GatekeeperVerdict = {
                    step: event.step,
                    passed: false,
                    blocking_issues: event.blocking_issues,
                    forced: event.forced,
                    retry: event.retry,
                  };
                  setGatekeeperVerdicts((prev) => [...prev, verdict]);
                  setProgress((prev) => [
                    ...prev,
                    { step: "gatekeeper_fail", message: event.message, gatekeeper: verdict },
                  ]);
                }
                break;

              case "gatekeeper_blocked":
                setCurrentStep("gatekeeper_blocked");
                setStatus("error");
                {
                  const verdict: GatekeeperVerdict = {
                    step: event.step,
                    passed: false,
                    blocking_issues: event.blocking_issues,
                  };
                  setGatekeeperVerdicts((prev) => [...prev, verdict]);
                  setProgress((prev) => [
                    ...prev,
                    { step: "gatekeeper_blocked", message: event.message, gatekeeper: verdict },
                  ]);
                }
                setError(event.message);
                toast({ title: "Pipeline blocked", description: event.message, variant: "destructive" });
                break;

              case "await_user_continue":
                setStatus("awaiting_continue");
                setCurrentStep("awaiting_continue");
                setManualPause({
                  step: event.step,
                  next_step: event.next_step,
                  continuation_id: event.continuation_id,
                  message: event.message,
                });
                setProgress((prev) => [
                  ...prev,
                  { step: "awaiting_continue", message: event.message },
                ]);
                break;

              case "auto_continue":
                // Store the continuation_id for automatic re-invocation
                setCurrentStep("auto_continuing");
                if (event.round) setCurrentRound(event.round);
                setProgress((prev) => [
                  ...prev,
                  { step: "auto_continue", round: event.rounds_so_far, message: event.message },
                ]);
                // Signal auto-continue via manualPause with a special marker
                setManualPause({
                  step: event.step,
                  next_step: "WRITER_LOOP",
                  continuation_id: event.continuation_id,
                  message: "__auto__",
                });
                break;

              case "complete":
                setStatus("complete");
                setCurrentStep("complete");
                setResult(event.optimization);
                if (event.optimization?.scorecard) {
                  setLatestScorecard(event.optimization.scorecard);
                }
                break;

              case "error":
                setStatus("error");
                setError(event.message);
                toast({ title: "Optimization failed", description: event.message, variant: "destructive" });
                break;
            }
          } catch {
            // Partial JSON, wait for more data
          }
        }
      }
    },
    [toast],
  );

  const callEdgeFunction = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!session?.access_token) {
        toast({ title: "Not signed in", description: "Please sign in to optimize your resume.", variant: "destructive" });
        return;
      }

      abortRef.current = new AbortController();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/optimize-resume`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(payload),
          signal: abortRef.current.signal,
        },
      );

      if (!response.ok || !response.body) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `Request failed with status ${response.status}`);
      }

      await processSSEStream(response);
    },
    [session, processSSEStream, toast],
  );

  const optimize = useCallback(
    async (resumeId: string, targetRole: string, location?: string, manualMode?: boolean) => {
      // Reset state
      setStatus("running");
      setProgress([]);
      setCurrentStep("init");
      setCurrentRound(0);
      setResult(null);
      setLatestScorecard(null);
      setGatekeeperVerdicts([]);
      setError(null);
      setManualPause(null);
      setIsManualMode(!!manualMode);
      resumeIdRef.current = resumeId;

      try {
        await callEdgeFunction({
          resumeId,
          targetRole,
          location,
          manual_mode: !!manualMode,
        });
      } catch (e: any) {
        if (e.name === "AbortError") return;
        console.error("Optimization error:", e);
        setStatus("error");
        setError(e.message || "Something went wrong");
        toast({ title: "Optimization failed", description: e.message || "Please try again.", variant: "destructive" });
      }
    },
    [callEdgeFunction, toast],
  );

  const continueOptimization = useCallback(
    async () => {
      if (!manualPause?.continuation_id || !resumeIdRef.current) return;

      const continuationId = manualPause.continuation_id;
      setStatus("running");
      setManualPause(null);
      setCurrentStep("resuming");

      try {
        await callEdgeFunction({
          resumeId: resumeIdRef.current,
          continuation_id: continuationId,
          manual_mode: isManualMode,
        });
      } catch (e: any) {
        if (e.name === "AbortError") return;
        console.error("Continue error:", e);
        setStatus("error");
        setError(e.message || "Something went wrong");
        toast({ title: "Continue failed", description: e.message || "Please try again.", variant: "destructive" });
      }
    },
    [manualPause, isManualMode, callEdgeFunction, toast],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setCurrentStep("");
    setProgress([]);
    setManualPause(null);
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress([]);
    setCurrentStep("");
    setCurrentRound(0);
    setResult(null);
    setLatestScorecard(null);
    setGatekeeperVerdicts([]);
    setError(null);
    setManualPause(null);
    setIsManualMode(false);
  }, []);

  return {
    status,
    progress,
    currentStep,
    currentRound,
    result,
    latestScorecard,
    gatekeeperVerdicts,
    error,
    manualPause,
    isManualMode,
    optimize,
    continueOptimization,
    cancel,
    reset,
  };
}
