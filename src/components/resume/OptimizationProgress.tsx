import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { OptimizationProgress as ProgressEvent, Scorecard } from "@/hooks/useResumeOptimizer";
import {
  Search,
  PenTool,
  ShieldCheck,
  Palette,
  CheckCircle2,
  Loader2,
  X,
} from "lucide-react";

interface OptimizationProgressProps {
  progress: ProgressEvent[];
  currentStep: string;
  currentRound: number;
  latestScorecard: Scorecard | null;
  onCancel: () => void;
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
  complete: { icon: CheckCircle2, label: "Complete", color: "text-success" },
};

const PIPELINE_STEPS = ["researcher", "writer", "critic", "designer", "complete"];

export function OptimizationProgress({
  progress,
  currentStep,
  currentRound,
  latestScorecard,
  onCancel,
}: OptimizationProgressProps) {
  const getStepStatus = (step: string) => {
    const baseStep = currentStep.replace("_done", "");
    const stepIdx = PIPELINE_STEPS.indexOf(step);
    const currentIdx = PIPELINE_STEPS.indexOf(baseStep);

    // Check if step is completed
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

  return (
    <Card>
      <CardContent className="py-8">
        <div className="text-center mb-8">
          <h3 className="text-xl font-semibold mb-1">Optimizing Your Resume</h3>
          <p className="text-muted-foreground text-sm">
            {currentRound > 0
              ? `Refinement round ${currentRound}`
              : "Starting optimization..."}
          </p>
        </div>

        {/* Pipeline steps */}
        <div className="max-w-md mx-auto space-y-4 mb-8">
          {PIPELINE_STEPS.filter((s) => s !== "complete").map((step) => {
            const status = getStepStatus(step);
            const config = STEP_CONFIG[step] || STEP_CONFIG.init;
            const Icon = config.icon;
            const isActive = status === "active";
            const isDone = status === "done";

            return (
              <div
                key={step}
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
            );
          })}
        </div>

        {/* Live score preview */}
        {latestScorecard && (
          <div className="max-w-md mx-auto grid grid-cols-3 gap-3 mb-6">
            <ScorePill label="ATS" score={latestScorecard.ats_score} />
            <ScorePill label="Keywords" score={latestScorecard.keyword_coverage_score} />
            <ScorePill label="Clarity" score={latestScorecard.clarity_score} />
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
