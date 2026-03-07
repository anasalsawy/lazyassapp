import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Timer,
  Bot,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { StepTimeline } from "./StepTimeline";

export interface AgentRun {
  id: string;
  run_type: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  error_message: string | null;
  summary_json: any;
  created_at: string;
}

export interface BrowserStep {
  id: string;
  run_id: string;
  step_number: number;
  url: string;
  final_url: string | null;
  page_title: string | null;
  actions: any;
  action_results: any;
  result_status: string;
  duration_ms: number | null;
  error_message: string | null;
  phase_name: string | null;
  planner_decision_type: string | null;
  researcher_reroute: boolean | null;
  created_at: string;
}

export const STATUS_CONFIG: Record<string, { color: string; icon: React.ElementType; pulse?: boolean }> = {
  running: { color: "bg-primary/15 text-primary border-primary/30", icon: Loader2, pulse: true },
  completed: { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  failed: { color: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  stale: { color: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertTriangle },
  queued: { color: "bg-muted text-muted-foreground border-border", icon: Clock },
};

interface RunRowProps {
  run: AgentRun;
  isExpanded: boolean;
  steps: BrowserStep[];
  onToggle: () => void;
}

export function RunRow({ run, isExpanded, steps, onToggle }: RunRowProps) {
  const config = STATUS_CONFIG[run.status] || STATUS_CONFIG.queued;
  const StatusIcon = config.icon;
  const summary = run.summary_json || {};
  const stepsUsed = summary.stepsUsed || steps.length || 0;
  const label = run.run_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

  const duration = run.started_at
    ? run.ended_at
      ? `${Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
      : `${Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000)}s`
    : "—";

  return (
    <div>
      {/* Run row */}
      <div
        className={`grid grid-cols-[24px_1fr_120px_100px_80px_32px] gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/20 ${
          isExpanded ? "bg-muted/10 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
        }`}
        onClick={onToggle}
      >
        <div className="flex items-center justify-center">
          <StatusIcon className={`w-4 h-4 ${config.color.split(" ")[1]} ${config.pulse ? "animate-spin" : ""}`} />
        </div>

        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{label}</p>
          {run.error_message && (
            <p className="text-[11px] text-destructive/80 truncate mt-0.5">{run.error_message.slice(0, 80)}</p>
          )}
        </div>

        <span className="text-xs text-muted-foreground flex items-center">
          {run.started_at
            ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true })
            : "Queued"}
        </span>

        <span className="text-xs tabular-nums flex items-center gap-1">
          <Timer className="w-3 h-3 text-muted-foreground" />
          {duration}
        </span>

        <span className="text-xs tabular-nums flex items-center">{stepsUsed}</span>

        <div className="flex items-center justify-center">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="bg-muted/5 border-t border-border/20 border-l-2 border-l-primary">
          {Object.keys(summary).length > 0 && (
            <div className="px-6 py-3 flex flex-wrap gap-2 border-b border-border/20">
              {Object.entries(summary).map(([key, val]) => (
                <div key={key} className="px-2.5 py-1 rounded-md bg-secondary/50 text-xs">
                  <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}: </span>
                  <span className="font-medium">
                    {Array.isArray(val) ? (val as string[]).join(", ") : String(val)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {run.error_message && (
            <div className="mx-6 mt-3 p-3 rounded-lg bg-destructive/10 text-destructive text-xs font-mono whitespace-pre-wrap break-all">
              {run.error_message}
            </div>
          )}

          <StepTimeline steps={steps} isRunning={run.status === "running"} />
        </div>
      )}
    </div>
  );
}
