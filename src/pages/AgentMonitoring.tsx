import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { Activity, RefreshCw, Loader2, Bot } from "lucide-react";
import { format } from "date-fns";
import { RunRow, type AgentRun, type BrowserStep } from "@/components/monitoring/RunRow";

export default function AgentMonitoring() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, BrowserStep[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const expandedRunRef = useRef(expandedRun);
  expandedRunRef.current = expandedRun;

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

  useEffect(() => {
    if (user) fetchRuns();
  }, [user, fetchRuns]);

  // Auto-poll every 3s if there are active runs
  useEffect(() => {
    const hasActive = runs.some(r => r.status === "running" || r.status === "queued");
    if (!hasActive) return;

    const interval = setInterval(() => {
      fetchRuns();
      const currentExpanded = expandedRunRef.current;
      if (currentExpanded) {
        const run = runs.find(r => r.id === currentExpanded);
        if (run?.status === "running") fetchSteps(currentExpanded);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [runs, fetchRuns, fetchSteps]);

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
              runs.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  isExpanded={expandedRun === run.id}
                  steps={steps[run.id] || []}
                  onToggle={() => toggleExpand(run.id)}
                />
              ))
            )}
          </ScrollArea>
        </div>
      </div>
    </AppLayout>
  );
}
