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
  running: { color: "bg-primary/20 text-primary", icon: Loader2 },
  completed: { color: "bg-green-500/20 text-green-600", icon: CheckCircle2 },
  failed: { color: "bg-destructive/20 text-destructive", icon: XCircle },
  stale: { color: "bg-yellow-500/20 text-yellow-600", icon: AlertTriangle },
  queued: { color: "bg-muted text-muted-foreground", icon: Clock },
};

const LOG_LEVEL_COLORS: Record<string, string> = {
  info: "text-blue-500",
  warn: "text-yellow-500",
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

  // Stats
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
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Activity className="w-8 h-8 text-primary" />
              Agent Monitoring
            </h1>
            <p className="text-muted-foreground">Track pipeline runs, logs, and Skyvern task status</p>
          </div>
          <Button onClick={triggerSync} disabled={isSyncing}>
            {isSyncing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Sync Statuses
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{runningCount}</p>
                  <p className="text-xs text-muted-foreground">Active Runs</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{completedToday}</p>
                  <p className="text-xs text-muted-foreground">Completed Today</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{failedCount}</p>
                  <p className="text-xs text-muted-foreground">Failed / Stale</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{runs.length}</p>
                  <p className="text-xs text-muted-foreground">Total Runs</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="runs">
          <TabsList>
            <TabsTrigger value="runs">Agent Runs</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline View</TabsTrigger>
          </TabsList>

          {/* RUNS TAB */}
          <TabsContent value="runs">
            <Card>
              <CardHeader>
                <CardTitle>Agent Runs</CardTitle>
                <CardDescription>All pipeline executions and their outcomes</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {runs.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
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
                            className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                              isSelected ? "border-primary bg-primary/5" : "hover:bg-secondary/50"
                            }`}
                            onClick={() => setSelectedRun(isSelected ? null : run)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
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
                                  <span className="text-xs text-muted-foreground">
                                    {summary.jobs_qualified} matches
                                  </span>
                                )}
                                <Badge className={`${statusStyle.color} gap-1`}>
                                  <StatusIcon className={`w-3 h-3 ${run.status === "running" ? "animate-spin" : ""}`} />
                                  {run.status}
                                </Badge>
                              </div>
                            </div>

                            {/* Expanded details */}
                            {isSelected && (
                              <div className="mt-4 pt-4 border-t border-border space-y-2">
                                {run.error_message && (
                                  <div className="p-3 rounded bg-destructive/10 text-destructive text-sm">
                                    {run.error_message}
                                  </div>
                                )}
                                {Object.keys(summary).length > 0 && (
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                    {Object.entries(summary).map(([key, val]) => (
                                      <div key={key} className="p-2 rounded bg-secondary/50">
                                        <p className="text-xs text-muted-foreground">{key.replace(/_/g, " ")}</p>
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

          {/* LOGS TAB */}
          <TabsContent value="logs">
            <Card>
              <CardHeader>
                <CardTitle>Agent Logs</CardTitle>
                <CardDescription>Detailed execution logs across all agents</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-1 font-mono text-sm">
                    {logs.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>No logs yet</p>
                      </div>
                    ) : (
                      logs.map((log) => (
                        <div key={log.id} className="flex gap-3 py-1.5 px-2 rounded hover:bg-secondary/30">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {log.created_at ? format(new Date(log.created_at), "HH:mm:ss") : "--"}
                          </span>
                          <span className={`text-xs uppercase w-12 ${LOG_LEVEL_COLORS[log.log_level] || ""}`}>
                            {log.log_level}
                          </span>
                          <Badge variant="outline" className="text-xs h-5">
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

          {/* PIPELINE VIEW TAB */}
          <TabsContent value="pipeline">
            <Card>
              <CardHeader>
                <CardTitle>Pipeline Status</CardTitle>
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
    {
      label: "CV Optimization",
      icon: FileText,
      run: latestResume,
    },
    {
      label: "Job Research",
      icon: Search,
      run: latestResearch,
    },
    {
      label: "Auto Apply",
      icon: Send,
      run: latestResearch?.summary_json?.jobs_submitted_to_skyvern > 0 ? latestResearch : null,
    },
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
            <div className={`flex-1 p-4 rounded-xl border ${run ? "border-primary/30" : "border-border"} text-center`}>
              <div className={`w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center ${run ? style.color : "bg-muted"}`}>
                <Icon className="w-6 h-6" />
              </div>
              <p className="font-medium text-sm">{stage.label}</p>
              {run ? (
                <div className="mt-2">
                  <Badge className={`${style.color} gap-1`}>
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
                <p className="text-xs text-muted-foreground mt-2">Not started</p>
              )}
            </div>
            {i < stages.length - 1 && (
              <ArrowRight className="w-5 h-5 text-muted-foreground hidden md:block flex-shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
