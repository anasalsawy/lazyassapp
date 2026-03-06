import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Globe,
  MousePointer,
  ArrowRight,
  Zap,
  Timer,
  ExternalLink,
  Bot,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface AgentRun {
  id: string;
  run_type: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  error_message: string | null;
  summary_json: any;
  created_at: string;
}

interface BrowserStep {
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

const STATUS_CONFIG: Record<string, { color: string; icon: React.ElementType; pulse?: boolean }> = {
  running: { color: "bg-primary/15 text-primary border-primary/30", icon: Loader2, pulse: true },
  completed: { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  failed: { color: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  stale: { color: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertTriangle },
  queued: { color: "bg-muted text-muted-foreground border-border", icon: Clock },
};

const STEP_STATUS_DOT: Record<string, string> = {
  success: "bg-emerald-400",
  failed: "bg-destructive",
  pending: "bg-amber-400 animate-pulse",
  skipped: "bg-muted-foreground",
};

export default function AgentMonitoring() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, BrowserStep[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading]);

  const fetchRuns = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("agent_runs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setRuns(data || []);
    setIsLoading(false);
    setLastRefresh(Date.now());
  }, [user]);

  const fetchSteps = useCallback(async (runId: string) => {
    const { data } = await supabase
      .from("browser_steps")
      .select("*")
      .eq("run_id", runId)
      .order("step_number", { ascending: true });
    setSteps(prev => ({ ...prev, [runId]: (data as BrowserStep[]) || [] }));
  }, []);

  // Initial fetch
  useEffect(() => {
    if (user) fetchRuns();
  }, [user, fetchRuns]);

  // Auto-poll every 3s if there are active runs
  useEffect(() => {
    const hasActive = runs.some(r => r.status === "running" || r.status === "queued");
    if (!hasActive) return;

    const interval = setInterval(() => {
      fetchRuns();
      // Also refresh steps for expanded active run
      if (expandedRun) {
        const run = runs.find(r => r.id === expandedRun);
        if (run?.status === "running") fetchSteps(expandedRun);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [runs, expandedRun, fetchRuns, fetchSteps]);

  const toggleExpand = (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
    } else {
      setExpandedRun(runId);
      if (!steps[runId]) fetchSteps(runId);
    }
  };

  const activeCount = runs.filter(r => r.status === "running").length;
  const todayCompleted = runs.filter(r => {
    if (r.status !== "completed") return false;
    return new Date(r.ended_at || r.created_at).toDateString() === new Date().toDateString();
  }).length;
  const failedCount = runs.filter(r => r.status === "failed" || r.status === "stale").length;

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="container max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Activity className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold">Live Ops</h1>
              <p className="text-xs text-muted-foreground">
                {activeCount > 0 ? (
                  <span className="text-primary font-medium">{activeCount} active</span>
                ) : "No active runs"} 
                {" · "}{todayCompleted} completed · {failedCount} failed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {format(lastRefresh, "HH:mm:ss")}
            </span>
            <Button variant="outline" size="sm" onClick={fetchRuns} className="h-8 gap-1.5 text-xs rounded-lg">
              <RefreshCw className="w-3 h-3" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Runs Table */}
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[24px_1fr_120px_100px_80px_32px] gap-3 px-4 py-2.5 bg-muted/30 border-b border-border/30 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            <span />
            <span>Task</span>
            <span>Started</span>
            <span>Duration</span>
            <span>Steps</span>
            <span />
          </div>

          <ScrollArea className="max-h-[calc(100vh-220px)]">
            {runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Bot className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">No runs yet</p>
              </div>
            ) : (
              runs.map(run => {
                const config = STATUS_CONFIG[run.status] || STATUS_CONFIG.queued;
                const StatusIcon = config.icon;
                const isExpanded = expandedRun === run.id;
                const runSteps = steps[run.id] || [];
                const summary = run.summary_json || {};
                const stepsUsed = summary.stepsUsed || runSteps.length || 0;
                const label = run.run_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

                const duration = run.started_at
                  ? run.ended_at
                    ? `${Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
                    : `${Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000)}s`
                  : "—";

                return (
                  <div key={run.id}>
                    {/* Run row */}
                    <div
                      className={`grid grid-cols-[24px_1fr_120px_100px_80px_32px] gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/20 ${
                        isExpanded ? "bg-muted/10 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
                      }`}
                      onClick={() => toggleExpand(run.id)}
                    >
                      {/* Status dot */}
                      <div className="flex items-center justify-center">
                        <StatusIcon className={`w-4 h-4 ${config.color.split(" ")[1]} ${config.pulse ? "animate-spin" : ""}`} />
                      </div>

                      {/* Task name + error preview */}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{label}</p>
                        {run.error_message && (
                          <p className="text-[11px] text-destructive/80 truncate mt-0.5">{run.error_message.slice(0, 80)}</p>
                        )}
                      </div>

                      {/* Started */}
                      <span className="text-xs text-muted-foreground flex items-center">
                        {run.started_at
                          ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true })
                          : "Queued"}
                      </span>

                      {/* Duration */}
                      <span className="text-xs tabular-nums flex items-center gap-1">
                        <Timer className="w-3 h-3 text-muted-foreground" />
                        {duration}
                      </span>

                      {/* Steps count */}
                      <span className="text-xs tabular-nums flex items-center">{stepsUsed}</span>

                      {/* Expand chevron */}
                      <div className="flex items-center justify-center">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Expanded: steps + summary */}
                    {isExpanded && (
                      <div className="bg-muted/5 border-t border-border/20 border-l-2 border-l-primary">
                        {/* Summary badges */}
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

                        {/* Error detail */}
                        {run.error_message && (
                          <div className="mx-6 mt-3 p-3 rounded-lg bg-destructive/10 text-destructive text-xs font-mono whitespace-pre-wrap break-all">
                            {run.error_message}
                          </div>
                        )}

                        {/* Steps timeline */}
                        {runSteps.length > 0 ? (
                          <div className="px-6 py-3 space-y-0">
                            {runSteps.map((step, idx) => {
                              const dotColor = STEP_STATUS_DOT[step.result_status] || "bg-muted";
                              const actions = Array.isArray(step.actions) ? step.actions : [];
                              const results = Array.isArray(step.action_results) ? step.action_results : [];

                              return (
                                <div key={step.id} className="flex gap-3 group">
                                  {/* Timeline line + dot */}
                                  <div className="flex flex-col items-center w-4 flex-shrink-0">
                                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${dotColor} ring-2 ring-background`} />
                                    {idx < runSteps.length - 1 && (
                                      <div className="w-px flex-1 bg-border/40 my-1" />
                                    )}
                                  </div>

                                  {/* Step content */}
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

                                    {/* URL */}
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                      <span className="text-[11px] text-muted-foreground truncate font-mono">
                                        {step.final_url || step.url}
                                      </span>
                                    </div>

                                    {/* Page title */}
                                    {step.page_title && (
                                      <p className="text-xs mt-0.5 text-foreground/80 truncate">{step.page_title}</p>
                                    )}

                                    {/* Actions */}
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

                                    {/* Error */}
                                    {step.error_message && (
                                      <p className="text-[11px] text-destructive mt-1 font-mono">{step.error_message}</p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="px-6 py-6 text-center text-xs text-muted-foreground">
                            {run.status === "running" ? (
                              <div className="flex items-center justify-center gap-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Waiting for steps…
                              </div>
                            ) : (
                              "No browser steps recorded"
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </ScrollArea>
        </div>
      </div>
    </AppLayout>
  );
}
