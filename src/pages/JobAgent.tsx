import { useState } from "react";
import { useJobAgent } from "@/hooks/useJobAgent";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Mail,
  Briefcase,
  Building2,
  MapPin,
  Zap,
  Settings,
  RefreshCw,
  Search,
  Brain,
  Sparkles,
  MessageSquare,
} from "lucide-react";

const SUPPORTED_SITES = [
  {
    key: "chatgpt",
    name: "ChatGPT",
    icon: Brain,
    color: "bg-emerald-600",
    required: true,
    description: "Required for Deep Research",
  },
  {
    key: "gmail",
    name: "Gmail",
    icon: Mail,
    color: "bg-red-500",
    required: false,
    description: "Email monitoring",
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    icon: Briefcase,
    color: "bg-blue-600",
    required: false,
    description: "Job applications",
  },
  {
    key: "indeed",
    name: "Indeed",
    icon: Building2,
    color: "bg-indigo-500",
    required: false,
    description: "Job applications",
  },
];

export default function JobAgent() {
  const {
    profile,
    recentRuns,
    recentJobs,
    recentApplications,
    isLoading,
    isRunning,
    researchStatus,
    loginSession,
    createProfile,
    startLogin,
    confirmLogin,
    runDeepResearch,
    cleanupSessions,
    refetch,
  } = useJobAgent();

  const [selectedSite, setSelectedSite] = useState<string | null>(null);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  const hasProfile = profile?.hasProfile;
  const sitesLoggedIn = profile?.sitesLoggedIn || [];
  const chatgptConnected = sitesLoggedIn.includes("chatgpt");

  return (
    <AppLayout>
      <div className="container max-w-6xl mx-auto py-8 px-4 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Brain className="h-8 w-8 text-primary" />
              Deep Research Job Agent
            </h1>
            <p className="text-muted-foreground mt-1">
              Powered by ChatGPT Deep Research — finds jobs that are deeply
              compatible with your complete professional profile
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={cleanupSessions}>
              Clear Sessions
            </Button>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Setup Section */}
        {!hasProfile && (
          <Card className="border-dashed border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Setup Your Job Agent
              </CardTitle>
              <CardDescription>
                Create a browser profile to save your login sessions. You'll
                only need to log in once.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={createProfile}>
                <Zap className="h-4 w-4 mr-2" />
                Create Browser Profile
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Account Connections */}
        {hasProfile && (
          <Card>
            <CardHeader>
              <CardTitle>Connected Accounts</CardTitle>
              <CardDescription>
                Log in to ChatGPT first (required for Deep Research), then
                optionally connect job sites for automated applications.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {SUPPORTED_SITES.map((site) => {
                  const isConnected = sitesLoggedIn.includes(site.key);
                  const Icon = site.icon;
                  const isPending = loginSession?.site === site.key;

                  return (
                    <div
                      key={site.key}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        isConnected
                          ? "border-green-500 bg-green-500/10"
                          : site.required
                          ? "border-primary/50 bg-primary/5"
                          : "border-muted hover:border-primary"
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`p-2 rounded-full ${site.color}`}>
                          <Icon className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <span className="font-medium text-sm">
                            {site.name}
                          </span>
                          {site.required && !isConnected && (
                            <Badge
                              variant="outline"
                              className="ml-2 text-[10px] px-1 py-0"
                            >
                              Required
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        {site.description}
                      </p>

                      {isConnected ? (
                        <Badge
                          variant="outline"
                          className="text-green-600 border-green-600"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                      ) : isPending ? (
                        <div className="space-y-2">
                          {loginSession?.liveViewUrl && (
                            <Button
                              size="sm"
                              variant="outline"
                              asChild
                              className="w-full"
                            >
                              <a
                                href={loginSession.liveViewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Open Browser
                              </a>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => confirmLogin(site.key)}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            I'm Logged In
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            setSelectedSite(site.key);
                            startLogin(site.key);
                          }}
                        >
                          Connect
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Deep Research Launch */}
        {hasProfile && chatgptConnected && (
          <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-primary/20">
            <CardContent className="py-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Deep Research Job Search
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    ChatGPT Deep Research will analyze your complete resume,
                    career trajectory, and skills — then search the web to find
                    jobs that are deeply compatible with your unique professional
                    profile. This is not a keyword search.
                  </p>
                </div>
                <Button
                  size="lg"
                  onClick={runDeepResearch}
                  disabled={isRunning}
                  className="min-w-[180px]"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Researching...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      Start Deep Research
                    </>
                  )}
                </Button>
              </div>

              {/* Research Progress */}
              {researchStatus && (
                <div className="mt-6 p-4 rounded-lg bg-background/50 border">
                  <div className="flex items-center gap-3 mb-3">
                    {researchStatus.status === "running" ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : researchStatus.status === "completed" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive" />
                    )}
                    <span className="font-medium">
                      {researchStatus.status === "running"
                        ? "Deep Research in Progress"
                        : researchStatus.status === "completed"
                        ? "Research Complete"
                        : "Research Failed"}
                    </span>
                    {researchStatus.stepCount && (
                      <Badge variant="secondary">
                        {researchStatus.stepCount} steps
                      </Badge>
                    )}
                  </div>

                  {researchStatus.status === "running" && (
                    <div className="space-y-2">
                      <Progress value={undefined} className="h-2" />
                      <p className="text-xs text-muted-foreground">
                        {researchStatus.message ||
                          "ChatGPT is deeply analyzing your profile and searching the web..."}
                      </p>
                      <p className="text-xs text-muted-foreground/70">
                        This typically takes 5-10 minutes. You can leave this
                        page and come back.
                      </p>
                    </div>
                  )}

                  {researchStatus.status === "completed" && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-green-600 font-medium">
                          {researchStatus.jobsFound} jobs found
                        </span>
                        <span className="text-muted-foreground">
                          {researchStatus.jobsStored} saved to your matches
                        </span>
                      </div>
                      {researchStatus.researchSummary && (
                        <div className="p-3 bg-muted/50 rounded text-sm">
                          <p className="font-medium text-xs text-muted-foreground mb-1">
                            Research Summary
                          </p>
                          <p>{researchStatus.researchSummary}</p>
                        </div>
                      )}
                      {researchStatus.candidateAnalysis && (
                        <div className="p-3 bg-muted/50 rounded text-sm">
                          <p className="font-medium text-xs text-muted-foreground mb-1">
                            Your Profile Analysis
                          </p>
                          <p>{researchStatus.candidateAnalysis}</p>
                        </div>
                      )}
                      {researchStatus.marketInsights && (
                        <div className="p-3 bg-muted/50 rounded text-sm">
                          <p className="font-medium text-xs text-muted-foreground mb-1">
                            Market Insights
                          </p>
                          <p>{researchStatus.marketInsights}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Not ready prompt */}
        {hasProfile && !chatgptConnected && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardContent className="py-6">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-6 w-6 text-amber-500" />
                <div>
                  <h3 className="font-semibold">Connect ChatGPT First</h3>
                  <p className="text-sm text-muted-foreground">
                    ChatGPT is required for Deep Research. Click "Connect" on the
                    ChatGPT card above and log in to your ChatGPT account. Make
                    sure you have access to Deep Research (ChatGPT Plus/Pro).
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Tabs */}
        <Tabs defaultValue="jobs" className="w-full">
          <TabsList>
            <TabsTrigger value="jobs">
              Jobs Found ({recentJobs.length})
            </TabsTrigger>
            <TabsTrigger value="applications">
              Applications ({recentApplications.length})
            </TabsTrigger>
            <TabsTrigger value="runs">
              Research Runs ({recentRuns.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="jobs" className="mt-4">
            {recentJobs.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No jobs found yet.</p>
                  <p className="text-sm mt-1">
                    Run Deep Research to discover deeply matched opportunities.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {recentJobs.map((job) => (
                  <Card key={job.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h4 className="font-semibold">{job.title}</h4>
                          <p className="text-sm text-muted-foreground">
                            {job.company} • {job.location || "Remote"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {job.match_score && (
                            <Badge
                              variant={
                                job.match_score >= 85
                                  ? "default"
                                  : job.match_score >= 70
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {job.match_score}% match
                            </Badge>
                          )}
                          {job.url && (
                            <Button size="sm" variant="ghost" asChild>
                              <a
                                href={job.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="applications" className="mt-4">
            {recentApplications.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No applications yet. Applications will appear here when the
                  agent applies to jobs for you.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {recentApplications.map((app) => (
                  <Card key={app.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold">{app.jobs?.title}</h4>
                          <p className="text-sm text-muted-foreground">
                            {app.jobs?.company}
                          </p>
                        </div>
                        <Badge
                          variant={
                            app.status === "applied"
                              ? "default"
                              : app.status === "interview"
                              ? "secondary"
                              : app.status === "rejected"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {app.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="runs" className="mt-4">
            {recentRuns.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No research runs yet. Click "Start Deep Research" to begin.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {recentRuns.map((run) => (
                  <Card key={run.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {run.status === "running" ? (
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          ) : run.status === "completed" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                          <div>
                            <p className="font-medium flex items-center gap-2">
                              {run.run_type === "deep_research"
                                ? "Deep Research"
                                : "Job Agent"}
                              <span className="text-xs text-muted-foreground">
                                {new Date(run.created_at).toLocaleDateString()}{" "}
                                {new Date(run.created_at).toLocaleTimeString()}
                              </span>
                            </p>
                            {run.summary_json?.jobs_stored != null && (
                              <p className="text-sm text-muted-foreground">
                                {run.summary_json.jobs_stored} jobs saved
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline">{run.status}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
