import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Activity,
  FileText,
  Search,
  Send,
  ArrowRight,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AgentRun {
  id: string;
  run_type: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  summary_json: any;
  created_at: string;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-primary animate-pulse",
  completed: "bg-success",
  failed: "bg-destructive",
  stale: "bg-warning",
  queued: "bg-muted-foreground",
};

export function PipelineStatusWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("agent_runs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);
      setRuns(data || []);
      setIsLoading(false);
    };
    fetch();
  }, [user]);

  if (isLoading) {
    return (
      <div className="stat-card flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const latestResearch = runs.find(r => r.run_type === "lever_job_research");
  const activeCount = runs.filter(r => r.status === "running").length;
  const recentRuns = runs.slice(0, 5);

  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-sm">Agent Pipeline</h3>
          {activeCount > 0 && (
            <Badge className="bg-primary/15 text-primary gap-1 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {activeCount} active
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/monitoring")} className="text-xs gap-1 h-7 text-muted-foreground hover:text-foreground">
          View All <ExternalLink className="w-3 h-3" />
        </Button>
      </div>

      {/* Mini Pipeline */}
      <div className="flex items-center gap-1 py-3 mb-3">
        {[
          { icon: FileText, label: "CV", type: "resume_optimization" },
          { icon: Search, label: "Research", type: "lever_job_research" },
          { icon: Send, label: "Apply", type: null },
        ].map((stage, i) => {
          const run = stage.type ? runs.find(r => r.run_type === stage.type) : latestResearch;
          const status = stage.type === null
            ? (latestResearch?.summary_json?.jobs_submitted_to_skyvern > 0 ? latestResearch?.status || "idle" : "idle")
            : (run?.status || "idle");
          const Icon = stage.icon;

          return (
            <div key={stage.label} className="flex items-center gap-1 flex-1">
              <div className="flex-1 flex flex-col items-center gap-1.5">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  status === "completed" ? "bg-success/10" :
                  status === "running" ? "bg-primary/10" :
                  "bg-muted/50"
                }`}>
                  <Icon className={`w-4 h-4 ${
                    status === "completed" ? "text-success" :
                    status === "running" ? "text-primary" :
                    "text-muted-foreground"
                  }`} />
                </div>
                <span className="text-[10px] text-muted-foreground font-medium">{stage.label}</span>
                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status] || "bg-muted"}`} />
              </div>
              {i < 2 && <ArrowRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0 mt-[-12px]" />}
            </div>
          );
        })}
      </div>

      {/* Recent Activity */}
      {recentRuns.length > 0 && (
        <div className="space-y-1.5 pt-3 border-t border-border/40">
          {recentRuns.map((run) => {
            const dotColor = STATUS_DOT[run.status] || "bg-muted";
            const label = run.run_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
            return (
              <div key={run.id} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                <span className="truncate flex-1 text-xs">{label}</span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
