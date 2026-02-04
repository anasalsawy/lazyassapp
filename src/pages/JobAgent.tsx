import { useState } from "react";
import { useJobAgent } from "@/hooks/useJobAgent";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Loader2, 
  Play, 
  CheckCircle2, 
  XCircle, 
  ExternalLink,
  Mail,
  Briefcase,
  Building2,
  MapPin,
  Zap,
  Settings,
  RefreshCw
} from "lucide-react";

const SUPPORTED_SITES = [
  { key: "gmail", name: "Gmail", icon: Mail, color: "bg-red-500" },
  { key: "linkedin", name: "LinkedIn", icon: Briefcase, color: "bg-blue-600" },
  { key: "indeed", name: "Indeed", icon: Building2, color: "bg-indigo-500" },
  { key: "glassdoor", name: "Glassdoor", icon: MapPin, color: "bg-green-500" },
];

export default function JobAgent() {
  const {
    profile,
    recentRuns,
    recentJobs,
    recentApplications,
    isLoading,
    isRunning,
    loginSession,
    createProfile,
    startLogin,
    confirmLogin,
    runAgent,
    refetch,
  } = useJobAgent();

  const [selectedSite, setSelectedSite] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasProfile = profile?.hasProfile;
  const sitesLoggedIn = profile?.sitesLoggedIn || [];

  return (
    <AppLayout>
      <div className="container max-w-6xl mx-auto py-8 px-4 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Job Agent</h1>
            <p className="text-muted-foreground">
              AI-powered job search that applies while you sleep
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
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
              Create a browser profile to save your login sessions. You'll only need to log in once.
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
              Log in to your job sites once. The agent will use these saved sessions.
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
                        : "border-muted hover:border-primary"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`p-2 rounded-full ${site.color}`}>
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <span className="font-medium">{site.name}</span>
                    </div>

                    {isConnected ? (
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Connected
                      </Badge>
                    ) : isPending ? (
                      <div className="space-y-2">
                        {loginSession?.liveViewUrl && (
                          <Button size="sm" variant="outline" asChild className="w-full">
                            <a href={loginSession.liveViewUrl} target="_blank" rel="noopener noreferrer">
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

      {/* Run Agent */}
      {hasProfile && sitesLoggedIn.length > 0 && (
        <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Ready to Hunt</h3>
                <p className="text-sm text-muted-foreground">
                  The agent will scrape jobs, match them to your profile, and apply automatically.
                </p>
              </div>
              <Button 
                size="lg" 
                onClick={runAgent}
                disabled={isRunning}
                className="min-w-[140px]"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Agent
                  </>
                )}
              </Button>
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
            Agent Runs ({recentRuns.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="mt-4">
          {recentJobs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No jobs found yet. Run the agent to start discovering jobs.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {recentJobs.map((job) => (
                <Card key={job.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold">{job.title}</h4>
                        <p className="text-sm text-muted-foreground">
                          {job.company} • {job.location || "Remote"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {job.match_score && (
                          <Badge variant={job.match_score >= 80 ? "default" : "secondary"}>
                            {job.match_score}% match
                          </Badge>
                        )}
                        {job.url && (
                          <Button size="sm" variant="ghost" asChild>
                            <a href={job.url} target="_blank" rel="noopener noreferrer">
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
                No applications yet. The agent will apply to matching jobs automatically.
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
                          app.status === "applied" ? "default" :
                          app.status === "interview" ? "secondary" :
                          app.status === "rejected" ? "destructive" : "outline"
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
                No agent runs yet. Click "Run Agent" to start.
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
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <div>
                          <p className="font-medium">
                            {new Date(run.created_at).toLocaleDateString()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(run.created_at).toLocaleTimeString()}
                          </p>
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
