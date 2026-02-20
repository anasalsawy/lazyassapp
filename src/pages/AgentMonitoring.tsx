import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  AlertTriangle,
  Search,
  FileText,
  Send,
  Bot,
  ArrowRight,
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

interface AgentLog {
  id: string;
  agent_name: string;
  log_level: string;
  message: string;
  metadata: any;
  task_id: string | null;
  created_at: string | null;
}

const RUN_TYPE_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  lever_job_research: { label: "Lever Job Research", icon: Search },
  resume_optimization: { label: "Resume Optimization", icon: FileText },
  job_application: { label: "Job Application", icon: Send },
  email_monitoring: { label: "Email Monitor", icon: Activity },
};

const STATUS_STYLES: Record<string, { color: string; icon: React.ElementType }> = {
  running: { color: "bg-primary/15 text-primary", icon: Loader2 },
  completed: { color: "bg-success/15 text-success", icon: CheckCircle2 },
  failed: { color: "bg-destructive/15 text-destructive", icon: XCircle },
  stale: { color: "bg-warning/15 text-warning", icon: AlertTriangle },
  queued: { color: "bg-muted text-muted-foreground", icon: Clock },
};

const LOG_LEVEL_COLORS: Record<string, string> = {
  info: "text-primary",
  warn: "text-warning",
  error: "text-destructive",
  debug: "text-muted-foreground",
};

export default function AgentMonitoring() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
    else if (user) fetchAll();
  }, [user, authLoading]);

  const fetchAll = async () => {
    setIsLoading(true);
    await Promise.all([fetchRuns(), fetchLogs()]);
    setIsLoading(false);
  };

  const fetchRuns = async () => {
    const { data } = await supabase
      .from("agent_runs")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setRuns(data || []);
  };

  const fetchLogs = async () => {
    const { data } = await supabase
      .from("agent_logs")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setLogs(data || []);
  };

  const triggerSync = async () => {
    setIsSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("sync-agent-status", {});
      if (error) throw error;
      toast({ title: "Sync complete", description: "Agent statuses have been updated" });
      await fetchAll();
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  const runningCount = runs.filter(r => r.status === "running").length;
  const completedToday = runs.filter(r => {
    if (r.status !== "completed") return false;
    const d = new Date(r.ended_at || r.created_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;
  const failedCount = runs.filter(r => r.status === "failed" || r.status === "stale").length;

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="container max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              Agent Monitoring
            </h1>
            <p className="text-muted-foreground mt-1">Track pipeline runs, logs, and task status</p>
          </div>
          <Button onClick={triggerSync} disabled={isSyncing} className="rounded-full">
            {isSyncing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Sync Statuses
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { icon: Zap, value: runningCount, label: "Active Runs", accent: "primary" },
            { icon: CheckCircle2, value: completedToday, label: "Completed Today", accent: "success" },
            { icon: XCircle, value: failedCount, label: "Failed / Stale", accent: "destructive" },
            { icon: Bot, value: runs.length, label: "Total Runs", accent: "primary" },
          ].map((card) => (
            <div key={card.label} className="stat-card">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl bg-${card.accent}/10 flex items-center justify-center`}>
                  <card.icon className={`w-5 h-5 text-${card.accent}`} />
                </div>
                <div>
                  <p className="text-2xl font-display font-bold">{card.value}</p>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="runs">
          <TabsList className="bg-secondary/50">
            <TabsTrigger value="runs">Agent Runs</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline View</TabsTrigger>
          </TabsList>

          <TabsContent value="runs">
            <Card className="border-border/40">
              <CardHeader>
                <CardTitle className="font-display">Agent Runs</CardTitle>
                <CardDescription>All pipeline executions and their outcomes</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {runs.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Bot className="w-12 h-12 mx-auto mb-4 opacity-30" />
                        <p>No agent runs yet</p>
                      </div>
                    ) : (
                      runs.map((run) => {
                        const typeConfig = RUN_TYPE_LABELS[run.run_type] || { label: run.run_type, icon: Bot };
                        const statusStyle = STATUS_STYLES[run.status] || STATUS_STYLES.queued;
                        const StatusIcon = statusStyle.icon;
                        const TypeIcon = typeConfig.icon;
                        const summary = run.summary_json || {};
                        const isSelected = selectedRun?.id === run.id;

                        return (
                          <div
                            key={run.id}
                            className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
                              isSelected ? "border-primary/40 bg-primary/5 shadow-md" : "border-border/30 hover:border-border hover:bg-secondary/30"
                            }`}
                            onClick={() => setSelectedRun(isSelected ? null : run)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-secondary/60 flex items-center justify-center">
                                  <TypeIcon className="w-4 h-4" />
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{typeConfig.label}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {run.started_at
                                      ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true })
                                      : "Queued"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {summary.jobs_qualified !== undefined && (
                                  <span className="text-xs text-muted-foreground">{summary.jobs_qualified} matches</span>
                                )}
                                <Badge className={`${statusStyle.color} gap-1 rounded-full`}>
                                  <StatusIcon className={`w-3 h-3 ${run.status === "running" ? "animate-spin" : ""}`} />
                                  {run.status}
                                </Badge>
                              </div>
                            </div>

                            {isSelected && (
                              <div className="mt-4 pt-4 border-t border-border/30 space-y-2">
                                {run.error_message && (
                                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                                    {run.error_message}
                                  </div>
                                )}
                                {Object.keys(summary).length > 0 && (
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                    {Object.entries(summary).map(([key, val]) => (
                                      <div key={key} className="p-2.5 rounded-lg bg-secondary/40">
                                        <p className="text-xs text-muted-foreground capitalize">{key.replace(/_/g, " ")}</p>
                                        <p className="text-sm font-medium truncate">
                                          {Array.isArray(val) ? (val as string[]).join(", ") : String(val)}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-2 text-xs text-muted-foreground">
                                  {run.started_at && <span>Started: {format(new Date(run.started_at), "PPp")}</span>}
                                  {run.ended_at && <span>• Ended: {format(new Date(run.ended_at), "PPp")}</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs">
            <Card className="border-border/40">
              <CardHeader>
                <CardTitle className="font-display">Agent Logs</CardTitle>
                <CardDescription>Detailed execution logs across all agents</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-0.5 font-mono text-sm">
                    {logs.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
                        <p>No logs yet</p>
                      </div>
                    ) : (
                      logs.map((log) => (
                        <div key={log.id} className="flex gap-3 py-1.5 px-3 rounded-lg hover:bg-secondary/30 transition-colors">
                          <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                            {log.created_at ? format(new Date(log.created_at), "HH:mm:ss") : "--"}
                          </span>
                          <span className={`text-xs uppercase w-12 font-semibold ${LOG_LEVEL_COLORS[log.log_level] || ""}`}>
                            {log.log_level}
                          </span>
                          <Badge variant="outline" className="text-xs h-5 rounded-full">
                            {log.agent_name}
                          </Badge>
                          <span className="text-sm flex-1">{log.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pipeline">
            <Card className="border-border/40">
              <CardHeader>
                <CardTitle className="font-display">Pipeline Status</CardTitle>
                <CardDescription>Visual overview of the CV → Research → Apply pipeline</CardDescription>
              </CardHeader>
              <CardContent>
                <PipelineView runs={runs} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function PipelineView({ runs }: { runs: AgentRun[] }) {
  const latestResume = runs.find(r => r.run_type === "resume_optimization");
  const latestResearch = runs.find(r => r.run_type === "lever_job_research");

  const stages = [
    { label: "CV Optimization", icon: FileText, run: latestResume },
    { label: "Job Research", icon: Search, run: latestResearch },
    { label: "Auto Apply", icon: Send, run: latestResearch?.summary_json?.jobs_submitted_to_skyvern > 0 ? latestResearch : null },
  ];

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-2 py-8">
      {stages.map((stage, i) => {
        const Icon = stage.icon;
        const run = stage.run;
        const status = run?.status || "idle";
        const style = STATUS_STYLES[status] || { color: "bg-muted text-muted-foreground", icon: Clock };
        const StIcon = style.icon;

        return (
          <div key={stage.label} className="flex items-center gap-2 flex-1">
            <div className={`flex-1 p-6 rounded-2xl border ${run ? "border-primary/30 bg-primary/3" : "border-border/30"} text-center transition-all`}>
              <div className={`w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center ${run ? style.color : "bg-muted/50"}`}>
                <Icon className="w-6 h-6" />
              </div>
              <p className="font-display font-semibold text-sm">{stage.label}</p>
              {run ? (
                <div className="mt-3">
                  <Badge className={`${style.color} gap-1 rounded-full`}>
                    <StIcon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
                    {status}
                  </Badge>
                  {run.summary_json && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {stage.label === "Job Research" && run.summary_json.jobs_qualified !== undefined
                        ? `${run.summary_json.jobs_qualified} matches found`
                        : stage.label === "Auto Apply" && run.summary_json.jobs_submitted_to_skyvern !== undefined
                        ? `${run.summary_json.jobs_submitted_to_skyvern} submitted`
                        : ""}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-3">Not started</p>
              )}
            </div>
            {i < 2 && <ArrowRight className="w-4 h-4 text-muted-foreground/30 flex-shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}
