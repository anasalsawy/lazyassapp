import { useState } from "react";
import { useAutomationSettings } from "@/hooks/useAutomationSettings";
import { useAgentOrchestrator } from "@/hooks/useAgentOrchestrator";
import { useApplications } from "@/hooks/useApplications";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Bot, Play, Pause, RefreshCw, Zap, Clock, Target,
  Shield, Building2, AlertCircle, CheckCircle, Loader2,
  Cpu, FileText, Mail, Search
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const agentInfo = [
  { 
    name: "Resume Agent", 
    icon: FileText, 
    description: "Analyzes and optimizes resumes for ATS",
    color: "text-primary" 
  },
  { 
    name: "Job Search Agent", 
    icon: Search, 
    description: "Scrapes and matches jobs from multiple boards",
    color: "text-accent" 
  },
  { 
    name: "Application Agent", 
    icon: Zap, 
    description: "Automates job application submissions",
    color: "text-success" 
  },
  { 
    name: "Cover Letter Agent", 
    icon: FileText, 
    description: "Generates personalized cover letters",
    color: "text-warning" 
  },
  { 
    name: "Email Agent", 
    icon: Mail, 
    description: "Manages recruiter communications",
    color: "text-destructive" 
  },
];

const Automation = () => {
  const { settings, loading, updateSettings, toggleAutoApply } = useAutomationSettings();
  const { loading: orchestratorLoading, tasks, logs, startWorkflow, getStatus, autoApply } = useAgentOrchestrator();
  const { stats: appStats } = useApplications();
  const [excludedCompany, setExcludedCompany] = useState("");

  const handleAddExcludedCompany = () => {
    if (excludedCompany && settings) {
      const newList = [...(settings.excluded_companies || []), excludedCompany];
      updateSettings({ excluded_companies: newList });
      setExcludedCompany("");
    }
  };

  const handleRemoveExcludedCompany = (company: string) => {
    if (settings) {
      const newList = (settings.excluded_companies || []).filter(c => c !== company);
      updateSettings({ excluded_companies: newList });
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Automation Center</h1>
          <p className="text-muted-foreground mt-1">
            Multi-agent system for automated job applications
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={getStatus} disabled={orchestratorLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${orchestratorLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={startWorkflow} disabled={orchestratorLoading}>
            <Play className="w-4 h-4 mr-2" />
            Start Workflow
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column - Settings */}
        <div className="lg:col-span-2 space-y-6">
          {/* Auto-Apply Toggle */}
          <Card className={settings?.auto_apply_enabled ? "border-success/50 bg-success/5" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    settings?.auto_apply_enabled ? "bg-success/10" : "bg-muted"
                  }`}>
                    <Bot className={`w-6 h-6 ${settings?.auto_apply_enabled ? "text-success" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <CardTitle>Auto-Apply Engine</CardTitle>
                    <CardDescription>
                      {settings?.auto_apply_enabled 
                        ? "Automatically applying to matching jobs"
                        : "Enable to start automatic applications"
                      }
                    </CardDescription>
                  </div>
                </div>
                <Switch
                  checked={settings?.auto_apply_enabled || false}
                  onCheckedChange={toggleAutoApply}
                />
              </div>
            </CardHeader>
            {settings?.auto_apply_enabled && (
              <CardContent>
                <div className="flex items-center gap-4 text-sm">
                  <Badge variant="secondary" className="bg-success/10 text-success">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                  <span className="text-muted-foreground">
                    {settings.applications_today} / {settings.daily_apply_limit} applications today
                  </span>
                  {settings.last_auto_apply_at && (
                    <span className="text-muted-foreground">
                      Last: {formatDistanceToNow(new Date(settings.last_auto_apply_at), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                Application Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Daily Limit */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Daily Application Limit</label>
                  <span className="text-sm text-muted-foreground">{settings?.daily_apply_limit || 10} per day</span>
                </div>
                <Slider
                  value={[settings?.daily_apply_limit || 10]}
                  onValueChange={([value]) => updateSettings({ daily_apply_limit: value })}
                  min={1}
                  max={50}
                  step={1}
                />
              </div>

              {/* Minimum Match Score */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Minimum Match Score</label>
                  <span className="text-sm text-muted-foreground">{settings?.min_match_score || 70}%</span>
                </div>
                <Slider
                  value={[settings?.min_match_score || 70]}
                  onValueChange={([value]) => updateSettings({ min_match_score: value })}
                  min={0}
                  max={100}
                  step={5}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Only auto-apply to jobs with match score above this threshold
                </p>
              </div>

              {/* Active Hours */}
              <div>
                <label className="text-sm font-medium">Active Hours (UTC)</label>
                <div className="flex items-center gap-4 mt-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={settings?.apply_hours_start || 9}
                      onChange={(e) => updateSettings({ apply_hours_start: parseInt(e.target.value) })}
                      className="w-20"
                      min={0}
                      max={23}
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="number"
                      value={settings?.apply_hours_end || 17}
                      onChange={(e) => updateSettings({ apply_hours_end: parseInt(e.target.value) })}
                      className="w-20"
                      min={0}
                      max={23}
                    />
                  </div>
                </div>
              </div>

              {/* Cover Letter */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Generate Cover Letters</label>
                  <p className="text-xs text-muted-foreground">AI will create personalized cover letters</p>
                </div>
                <Switch
                  checked={settings?.require_cover_letter || false}
                  onCheckedChange={(checked) => updateSettings({ require_cover_letter: checked })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Excluded Companies */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Excluded Companies
              </CardTitle>
              <CardDescription>
                These companies will be skipped during auto-apply
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Input
                  placeholder="Company name..."
                  value={excludedCompany}
                  onChange={(e) => setExcludedCompany(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddExcludedCompany()}
                />
                <Button onClick={handleAddExcludedCompany}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(settings?.excluded_companies || []).map((company) => (
                  <Badge
                    key={company}
                    variant="secondary"
                    className="cursor-pointer hover:bg-destructive/10"
                    onClick={() => handleRemoveExcludedCompany(company)}
                  >
                    <Building2 className="w-3 h-3 mr-1" />
                    {company}
                    <span className="ml-1 text-muted-foreground">×</span>
                  </Badge>
                ))}
                {(settings?.excluded_companies || []).length === 0 && (
                  <span className="text-sm text-muted-foreground">No companies excluded</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3">
                <Button 
                  variant="outline" 
                  className="justify-start"
                  onClick={autoApply}
                  disabled={orchestratorLoading}
                >
                  <Zap className="w-4 h-4 mr-2 text-warning" />
                  Run Auto-Apply Now
                </Button>
                <Button 
                  variant="outline" 
                  className="justify-start"
                  onClick={startWorkflow}
                  disabled={orchestratorLoading}
                >
                  <RefreshCw className="w-4 h-4 mr-2 text-primary" />
                  Full Workflow Cycle
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Agents & Logs */}
        <div className="space-y-6">
          {/* Agent Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="w-5 h-5" />
                Active Agents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {agentInfo.map((agent) => {
                const Icon = agent.icon;
                return (
                  <div
                    key={agent.name}
                    className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50"
                  >
                    <Icon className={`w-5 h-5 ${agent.color}`} />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.description}</p>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No recent activity
                </p>
              ) : (
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {logs.slice(0, 10).map((log) => (
                    <div key={log.id} className="flex items-start gap-2 text-sm">
                      <div className={`w-2 h-2 rounded-full mt-2 ${
                        log.log_level === "error" ? "bg-destructive" :
                        log.log_level === "warn" ? "bg-warning" : "bg-success"
                      }`} />
                      <div>
                        <p className="text-foreground">{log.message}</p>
                        <p className="text-xs text-muted-foreground">
                          {log.agent_name} • {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle>Application Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 rounded-lg bg-primary/10">
                  <p className="text-2xl font-bold text-primary">{appStats.total}</p>
                  <p className="text-xs text-muted-foreground">Total Sent</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-success/10">
                  <p className="text-2xl font-bold text-success">{appStats.interviews}</p>
                  <p className="text-xs text-muted-foreground">Interviews</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-warning/10">
                  <p className="text-2xl font-bold text-warning">{appStats.underReview}</p>
                  <p className="text-xs text-muted-foreground">Under Review</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-accent/10">
                  <p className="text-2xl font-bold text-accent">{appStats.offers}</p>
                  <p className="text-xs text-muted-foreground">Offers</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Automation;
