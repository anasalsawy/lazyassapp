import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Briefcase, 
  Send, 
  MessageSquare, 
  TrendingUp,
  Settings,
  RefreshCw,
  Play,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Eye,
  RotateCw,
  MoreHorizontal
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Status configuration as per spec
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  "pending-apply": { label: "Pending", color: "bg-muted text-muted-foreground", icon: Clock },
  "applying": { label: "Applying…", color: "bg-primary/20 text-primary", icon: Loader2 },
  "applied": { label: "Applied", color: "bg-blue-500/20 text-blue-600", icon: Send },
  "in-review": { label: "In Review", color: "bg-purple-500/20 text-purple-600", icon: Eye },
  "interview": { label: "Interview", color: "bg-success/20 text-success", icon: MessageSquare },
  "offer": { label: "Offer", color: "bg-yellow-500/20 text-yellow-600", icon: TrendingUp },
  "rejected": { label: "Rejected", color: "bg-destructive/20 text-destructive", icon: XCircle },
  "error": { label: "Error", color: "bg-destructive/20 text-destructive", icon: AlertCircle },
  "needs-user-action": { label: "Action Needed", color: "bg-warning/20 text-warning", icon: AlertCircle },
};

interface Application {
  id: string;
  job_id: string;
  platform: string;
  job_title: string | null;
  company_name: string | null;
  job_url: string | null;
  status: string;
  status_message: string | null;
  applied_at: string;
  job?: {
    title: string;
    company: string;
    location: string | null;
    url: string | null;
  };
}

export default function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoApplyEnabled, setAutoApplyEnabled] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [processingApps, setProcessingApps] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      fetchApplications();
      fetchSettings();
    }
  }, [user, authLoading]);

  const fetchApplications = async () => {
    try {
      const { data, error } = await supabase
        .from("applications")
        .select(`
          *,
          job:jobs(title, company, location, url)
        `)
        .eq("user_id", user?.id)
        .order("applied_at", { ascending: false });

      if (error) throw error;
      setApplications(data || []);
      setLastChecked(new Date());
    } catch (error: any) {
      console.error("Error fetching applications:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const { data } = await supabase
        .from("automation_settings")
        .select("auto_apply_enabled")
        .eq("user_id", user?.id)
        .single();
      
      if (data) {
        setAutoApplyEnabled(data.auto_apply_enabled || false);
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    }
  };

  const refreshAllStatuses = async () => {
    setIsRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("job-agent", {
        body: { action: "check_all_statuses" },
      });
      if (error) throw error;
      
      // Re-fetch after a delay to get updated data
      setTimeout(() => {
        fetchApplications();
        setIsRefreshing(false);
      }, 5000);
      
      toast({ title: "Refreshing statuses...", description: "This may take a moment" });
    } catch (error: any) {
      setIsRefreshing(false);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleApplyNow = async (appId: string) => {
    setProcessingApps(prev => new Set(prev).add(appId));
    try {
      await supabase
        .from("applications")
        .update({ status: "applying" })
        .eq("id", appId);
      
      const { error } = await supabase.functions.invoke("job-agent", {
        body: { action: "apply_single", applicationId: appId },
      });
      
      if (error) throw error;
      fetchApplications();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setProcessingApps(prev => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  };

  const handleCheckStatus = async (appId: string) => {
    setProcessingApps(prev => new Set(prev).add(appId));
    try {
      const { error } = await supabase.functions.invoke("job-agent", {
        body: { action: "check_status", applicationId: appId },
      });
      
      if (error) throw error;
      
      setTimeout(() => {
        fetchApplications();
        setProcessingApps(prev => {
          const next = new Set(prev);
          next.delete(appId);
          return next;
        });
      }, 3000);
    } catch (error: any) {
      setProcessingApps(prev => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleRetry = async (appId: string) => {
    await handleApplyNow(appId);
  };

  const toggleAutoApply = async (enabled: boolean) => {
    setAutoApplyEnabled(enabled);
    try {
      await supabase
        .from("automation_settings")
        .upsert({ user_id: user?.id, auto_apply_enabled: enabled });
      
      toast({ 
        title: enabled ? "Auto-apply enabled" : "Auto-apply disabled",
        description: enabled ? "The agent will now apply to matching jobs automatically" : "You'll need to approve each application"
      });
    } catch (error) {
      console.error("Error updating settings:", error);
    }
  };

  // Calculate stats
  const stats = {
    applied: applications.filter(a => ["applied", "applying"].includes(a.status)).length,
    inProgress: applications.filter(a => ["in-review", "interview"].includes(a.status)).length,
    responses: applications.filter(a => ["interview", "offer", "rejected"].includes(a.status)).length,
  };

  const getActionButton = (app: Application) => {
    const isProcessing = processingApps.has(app.id);
    
    switch (app.status) {
      case "pending-apply":
        return (
          <Button size="sm" onClick={() => handleApplyNow(app.id)} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
            Apply Now
          </Button>
        );
      case "applying":
        return (
          <Button size="sm" disabled>
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            Applying…
          </Button>
        );
      case "applied":
      case "in-review":
        return (
          <Button size="sm" variant="outline" onClick={() => handleCheckStatus(app.id)} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Check Status
          </Button>
        );
      case "interview":
        return (
          <Button size="sm" variant="outline">
            <Eye className="w-4 h-4 mr-1" />
            View Details
          </Button>
        );
      case "offer":
        return (
          <Button size="sm" variant="outline">
            <Eye className="w-4 h-4 mr-1" />
            View Offer
          </Button>
        );
      case "rejected":
        return (
          <Button size="sm" variant="ghost">
            <Eye className="w-4 h-4 mr-1" />
            View Reason
          </Button>
        );
      case "needs-user-action":
        return (
          <Button size="sm" className="bg-warning hover:bg-warning/90">
            <AlertCircle className="w-4 h-4 mr-1" />
            Resolve
          </Button>
        );
      case "error":
        return (
          <Button size="sm" variant="outline" onClick={() => handleRetry(app.id)} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4 mr-1" />}
            Retry
          </Button>
        );
      default:
        return null;
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">Dashboard</h1>
            <nav className="hidden md:flex items-center gap-4">
              <Link to="/connections" className="text-sm text-muted-foreground hover:text-foreground">
                Connections
              </Link>
              <Link to="/resume" className="text-sm text-muted-foreground hover:text-foreground">
                Resume
              </Link>
              <Link to="/settings" className="text-sm text-muted-foreground hover:text-foreground">
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {lastChecked && `Last checked: ${formatDistanceToNow(lastChecked, { addSuffix: true })}`}
            </span>
            <Button variant="outline" size="sm" onClick={refreshAllStatuses} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatsCard 
            title="Applied Today" 
            value={stats.applied} 
            icon={Send}
            description="Applications submitted"
          />
          <StatsCard 
            title="In Progress" 
            value={stats.inProgress} 
            icon={Clock}
            description="Under review or interview"
          />
          <StatsCard 
            title="Responses" 
            value={stats.responses} 
            icon={MessageSquare}
            description="Received feedback"
          />
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Auto-Apply</p>
                  <p className="text-sm font-medium">{autoApplyEnabled ? "Active" : "Paused"}</p>
                </div>
                <Switch
                  checked={autoApplyEnabled}
                  onCheckedChange={toggleAutoApply}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Applications Timeline */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Applications</CardTitle>
                <CardDescription>
                  Track your job applications and their statuses
                </CardDescription>
              </div>
              <Button onClick={() => navigate("/jobs")}>
                <Briefcase className="w-4 h-4 mr-2" />
                Find Jobs
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {applications.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No applications yet.</p>
                <p className="text-sm">Start by searching for jobs or enable auto-apply.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {applications.map((app) => {
                  const statusConfig = STATUS_CONFIG[app.status] || STATUS_CONFIG["applied"];
                  const StatusIcon = statusConfig.icon;
                  const isProcessing = processingApps.has(app.id);

                  return (
                    <div
                      key={app.id}
                      className="flex items-center justify-between p-4 rounded-xl border border-border hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        {/* Platform icon */}
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Briefcase className="w-5 h-5 text-primary" />
                        </div>
                        
                        {/* Job info */}
                        <div className="min-w-0">
                          <h4 className="font-medium truncate">
                            {app.job_title || app.job?.title || "Unknown Position"}
                          </h4>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="truncate">
                              {app.company_name || app.job?.company || "Unknown Company"}
                            </span>
                            <span>•</span>
                            <Badge variant="outline" className="text-xs capitalize">
                              {app.platform || "other"}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        {/* Applied date */}
                        <span className="text-xs text-muted-foreground hidden md:block">
                          {formatDistanceToNow(new Date(app.applied_at), { addSuffix: true })}
                        </span>

                        {/* Status badge */}
                        <Badge className={`${statusConfig.color} gap-1`}>
                          {app.status === "applying" || isProcessing ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <StatusIcon className="w-3 h-3" />
                          )}
                          {statusConfig.label}
                        </Badge>

                        {/* Action button */}
                        {getActionButton(app)}

                        {/* More menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {(app.job_url || app.job?.url) && (
                              <DropdownMenuItem asChild>
                                <a href={app.job_url || app.job?.url || "#"} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="w-4 h-4 mr-2" />
                                  Open Job Page
                                </a>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem>
                              <Eye className="w-4 h-4 mr-2" />
                              View Logs
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-muted-foreground">
                              Archive
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function StatsCard({ title, value, icon: Icon, description }: {
  title: string;
  value: number;
  icon: React.ElementType;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
