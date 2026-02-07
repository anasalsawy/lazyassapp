import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  OptimizationProgress as ProgressEvent,
  Scorecard,
  GatekeeperVerdict,
  ManualPause,
} from "@/hooks/useResumeOptimizer";
import {
  Search,
  PenTool,
  ShieldCheck,
  Palette,
  CheckCircle2,
  Loader2,
  X,
  ShieldAlert,
  ShieldOff,
  PlayCircle,
  PauseCircle,
} from "lucide-react";

interface OptimizationProgressProps {
  progress: ProgressEvent[];
  currentStep: string;
  currentRound: number;
  latestScorecard: Scorecard | null;
  gatekeeperVerdicts: GatekeeperVerdict[];
  manualPause: ManualPause | null;
  onCancel: () => void;
  onContinue: () => void;
}

const STEP_CONFIG: Record<
  string,
  { icon: React.ElementType; label: string; color: string }
> = {
  init: { icon: Loader2, label: "Preparing", color: "text-muted-foreground" },
  researcher: { icon: Search, label: "Industry Analysis", color: "text-blue-500" },
  researcher_done: { icon: Search, label: "Industry Analysis", color: "text-success" },
  writer: { icon: PenTool, label: "Writing", color: "text-amber-500" },
  writer_done: { icon: PenTool, label: "Writing", color: "text-success" },
  critic: { icon: ShieldCheck, label: "Quality Review", color: "text-purple-500" },
  critic_done: { icon: ShieldCheck, label: "Quality Review", color: "text-success" },
  designer: { icon: Palette, label: "Layout Design", color: "text-pink-500" },
  designer_done: { icon: Palette, label: "Layout Design", color: "text-success" },
  gatekeeper: { icon: ShieldAlert, label: "Gatekeeper Audit", color: "text-orange-500" },
  gatekeeper_pass: { icon: ShieldAlert, label: "Gatekeeper Audit", color: "text-success" },
  gatekeeper_fail: { icon: ShieldOff, label: "Gatekeeper Audit", color: "text-destructive" },
  complete: { icon: CheckCircle2, label: "Complete", color: "text-success" },
};

const PIPELINE_STEPS = ["researcher", "writer", "critic", "designer", "complete"];

export function OptimizationProgress({
  progress,
  currentStep,
  currentRound,
  latestScorecard,
  gatekeeperVerdicts,
  manualPause,
  onCancel,
  onContinue,
}: OptimizationProgressProps) {
  const isPaused = !!manualPause;

  const getStepStatus = (step: string) => {
    const baseStep = currentStep.replace("_done", "").replace("gatekeeper_pass", "gatekeeper").replace("gatekeeper_fail", "gatekeeper");
    const stepIdx = PIPELINE_STEPS.indexOf(step);
    const currentIdx = PIPELINE_STEPS.indexOf(baseStep);

    const doneKey = `${step}_done`;
    if (
      progress.some((p) => p.step === doneKey) ||
      (step === "complete" && currentStep === "complete")
    ) {
      return "done";
    }
    if (stepIdx === currentIdx) return "active";
    if (stepIdx < currentIdx) return "done";
    return "pending";
  };

  const getLatestGateForStep = (step: string): GatekeeperVerdict | undefined => {
    const stepUpper = step.toUpperCase();
    return [...gatekeeperVerdicts].reverse().find(
      (v) => v.step.startsWith(stepUpper),
    );
  };

  return (
    <Card>
      <CardContent className="py-8">
        <div className="text-center mb-8">
          <h3 className="text-xl font-semibold mb-1">
            {isPaused ? "Pipeline Paused" : "Optimizing Your Resume"}
          </h3>
          <p className="text-muted-foreground text-sm">
            {isPaused
              ? "Review the results below and continue when ready"
              : currentRound > 0
              ? `Refinement round ${currentRound}`
              : "Starting optimization..."}
          </p>
        </div>

        {/* Manual pause banner */}
        {isPaused && manualPause && (
          <div className="max-w-md mx-auto mb-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-start gap-3">
              <PauseCircle className="w-6 h-6 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {manualPause.message}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Completed: <strong>{manualPause.step.replace(/_/g, " ")}</strong>
                  {" → "}Next: <strong>{manualPause.next_step.replace(/_/g, " ")}</strong>
                </p>
                <Button
                  onClick={onContinue}
                  className="mt-3 gap-2"
                  size="sm"
                >
                  <PlayCircle className="w-4 h-4" />
                  Continue to {manualPause.next_step.replace(/_/g, " ")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Pipeline steps */}
        <div className="max-w-md mx-auto space-y-4 mb-8">
          {PIPELINE_STEPS.filter((s) => s !== "complete").map((step) => {
            const status = getStepStatus(step);
            const config = STEP_CONFIG[step] || STEP_CONFIG.init;
            const Icon = config.icon;
            const isActive = status === "active" && !isPaused;
            const isDone = status === "done";
            const gateVerdict = getLatestGateForStep(step);

            return (
              <div key={step}>
                <div
                  className={`flex items-center gap-4 p-3 rounded-lg transition-all ${
                    isActive
                      ? "bg-primary/5 border border-primary/20"
                      : isDone
                      ? "bg-success/5 border border-success/20"
                      : "opacity-40"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      isActive
                        ? "bg-primary/10"
                        : isDone
                        ? "bg-success/10"
                        : "bg-muted"
                    }`}
                  >
                    {isActive ? (
                      <Loader2 className={`w-5 h-5 ${config.color} animate-spin`} />
                    ) : isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-success" />
                    ) : (
                      <Icon className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p
                      className={`font-medium text-sm ${
                        isActive || isDone ? "" : "text-muted-foreground"
                      }`}
                    >
                      {config.label}
                      {step === "writer" && currentRound > 0 && isActive
                        ? ` (v${currentRound})`
                        : ""}
                      {step === "critic" && currentRound > 0 && isActive
                        ? ` (round ${currentRound})`
                        : ""}
                    </p>
                    {isActive && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {progress[progress.length - 1]?.message || "Processing..."}
                      </p>
                    )}
                  </div>
                  {isDone && step === "critic" && latestScorecard && (
                    <Badge
                      variant="outline"
                      className={
                        latestScorecard.overall_score >= 90
                          ? "text-success border-success"
                          : "text-amber-600 border-amber-400"
                      }
                    >
                      {latestScorecard.overall_score}%
                    </Badge>
                  )}
                </div>

                {/* Gatekeeper sub-row */}
                {gateVerdict && (isDone || isActive) && (
                  <div
                    className={`ml-7 mt-1 flex items-center gap-2 px-3 py-1.5 rounded text-xs ${
                      gateVerdict.passed
                        ? "bg-success/5 text-success"
                        : gateVerdict.forced
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-destructive/5 text-destructive"
                    }`}
                  >
                    {gateVerdict.passed ? (
                      <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
                    ) : (
                      <ShieldOff className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                    <span className="font-medium">
                      {gateVerdict.passed
                        ? "✅ Gatekeeper: Verified"
                        : gateVerdict.forced
                        ? "⚠️ Gatekeeper: Forced pass"
                        : `❌ Gatekeeper: ${gateVerdict.blocking_issues?.length || 0} issues`}
                    </span>
                    {gateVerdict.passed && gateVerdict.next_step && (
                      <span className="text-muted-foreground ml-1">
                        → {gateVerdict.next_step.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Gatekeeper activity indicator */}
        {!isPaused && (currentStep === "gatekeeper" ||
          currentStep === "gatekeeper_pass" ||
          currentStep === "gatekeeper_fail") && (
          <div className="max-w-md mx-auto mb-4 p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                {currentStep === "gatekeeper" ? (
                  <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                ) : currentStep === "gatekeeper_pass" ? (
                  <ShieldAlert className="w-4 h-4 text-success" />
                ) : (
                  <ShieldOff className="w-4 h-4 text-destructive" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Process Auditor</p>
                <p className="text-xs text-muted-foreground">
                  {progress[progress.length - 1]?.message || "Verifying step output..."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Live score preview */}
        {latestScorecard && (
          <div className="max-w-md mx-auto grid grid-cols-3 gap-3 mb-6">
            <ScorePill label="ATS" score={latestScorecard.ats_score} />
            <ScorePill label="Keywords" score={latestScorecard.keyword_coverage_score} />
            <ScorePill label="Clarity" score={latestScorecard.clarity_score} />
          </div>
        )}

        {/* Gate audit trail */}
        {gatekeeperVerdicts.length > 0 && (
          <div className="max-w-md mx-auto mb-6">
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Audit Trail ({gatekeeperVerdicts.length} gates checked)
            </p>
            <div className="space-y-1">
              {gatekeeperVerdicts.slice(-5).map((v, i) => (
                <div
                  key={i}
                  className={`text-xs flex items-center gap-2 px-2 py-1 rounded ${
                    v.passed
                      ? "text-success/80"
                      : v.forced
                      ? "text-amber-600/80"
                      : "text-destructive/80"
                  }`}
                >
                  <span className="font-mono">{v.passed ? "✓" : v.forced ? "⚠" : "✗"}</span>
                  <span>{v.step.replace(/_/g, " ")}</span>
                  {v.blocking_issues && v.blocking_issues.length > 0 && (
                    <span className="text-muted-foreground">
                      — {v.blocking_issues[0].substring(0, 50)}
                      {v.blocking_issues[0].length > 50 ? "..." : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={onCancel} className="gap-2">
            <X className="w-4 h-4" />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScorePill({ label, score }: { label: string; score: number }) {
  const color =
    score >= 90 ? "text-success" : score >= 75 ? "text-amber-600" : "text-destructive";
  return (
    <div className="text-center p-2 rounded-lg bg-muted/50">
      <p className={`text-lg font-bold ${color}`}>{score}%</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
