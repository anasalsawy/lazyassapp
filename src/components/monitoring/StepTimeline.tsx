import { Badge } from "@/components/ui/badge";
import { Globe, MousePointer, Loader2 } from "lucide-react";
import type { BrowserStep } from "./RunRow";

const STEP_STATUS_DOT: Record<string, string> = {
  success: "bg-emerald-400",
  failed: "bg-destructive",
  pending: "bg-amber-400 animate-pulse",
  skipped: "bg-muted-foreground",
};

interface StepTimelineProps {
  steps: BrowserStep[];
  isRunning: boolean;
}

export function StepTimeline({ steps, isRunning }: StepTimelineProps) {
  if (steps.length === 0) {
    return (
      <div className="px-6 py-6 text-center text-xs text-muted-foreground">
        {isRunning ? (
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Waiting for steps…
          </div>
        ) : (
          "No browser steps recorded"
        )}
      </div>
    );
  }

  return (
    <div className="px-6 py-3 space-y-0">
      {steps.map((step, idx) => {
        const dotColor = STEP_STATUS_DOT[step.result_status] || "bg-muted";
        const actions = Array.isArray(step.actions) ? step.actions : [];
        const results = Array.isArray(step.action_results) ? step.action_results : [];

        return (
          <div key={step.id} className="flex gap-3 group">
            <div className="flex flex-col items-center w-4 flex-shrink-0">
              <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${dotColor} ring-2 ring-background`} />
              {idx < steps.length - 1 && <div className="w-px flex-1 bg-border/40 my-1" />}
            </div>

            <div className="flex-1 pb-4 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono text-muted-foreground">#{step.step_number}</span>
                {step.phase_name && (
                  <Badge variant="outline" className="text-[10px] h-4 rounded-full px-1.5">
                    {step.phase_name}
                  </Badge>
                )}
                {step.planner_decision_type && (
                  <Badge variant="outline" className="text-[10px] h-4 rounded-full px-1.5 border-primary/30 text-primary">
                    {step.planner_decision_type}
                  </Badge>
                )}
                {step.researcher_reroute && (
                  <Badge className="text-[10px] h-4 rounded-full px-1.5 bg-amber-500/15 text-amber-400 border-amber-500/30">
                    reroute
                  </Badge>
                )}
                {step.duration_ms && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">{step.duration_ms}ms</span>
                )}
              </div>

              <div className="flex items-center gap-1.5 mt-1">
                <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <span className="text-[11px] text-muted-foreground truncate font-mono">
                  {step.final_url || step.url}
                </span>
              </div>

              {step.page_title && (
                <p className="text-xs mt-0.5 text-foreground/80 truncate">{step.page_title}</p>
              )}

              {actions.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {actions.map((action: any, ai: number) => (
                    <div key={ai} className="flex items-center gap-1.5 text-[11px]">
                      <MousePointer className="w-3 h-3 text-primary/60 flex-shrink-0" />
                      <span className="font-mono text-foreground/70">
                        {typeof action === "string" ? action : JSON.stringify(action)}
                      </span>
                      {results[ai] && (
                        <span className={`text-[10px] ${
                          results[ai]?.success !== false ? "text-emerald-400" : "text-destructive"
                        }`}>
                          {results[ai]?.success !== false ? "✓" : "✗"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {step.error_message && (
                <p className="text-[11px] text-destructive mt-1 font-mono">{step.error_message}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
