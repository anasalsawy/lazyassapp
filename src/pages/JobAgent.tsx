import { useState, useCallback } from "react";
import { useJobAgent } from "@/hooks/useJobAgent";
import { useJobs } from "@/hooks/useJobs";
import { useResumes } from "@/hooks/useResumes";
import { useJobPreferences } from "@/hooks/useJobPreferences";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Mail,
  Briefcase,
  Building2,
  MapPin,
  DollarSign,
  Zap,
  Settings,
  Search,
  Send,
  RefreshCw,
  Trash2,
  Heart,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const SUPPORTED_SITES = [
  { key: "gmail", name: "Gmail", icon: Mail, color: "bg-red-500" },
  { key: "linkedin", name: "LinkedIn", icon: Briefcase, color: "bg-blue-600" },
  { key: "indeed", name: "Indeed", icon: Building2, color: "bg-indigo-500" },
  { key: "glassdoor", name: "Glassdoor", icon: MapPin, color: "bg-green-500" },
];

export default function JobAgent() {
  const { user } = useAuth();
  const {
    profile,
    isLoading,
    loginSession,
    startLogin,
    confirmLogin,
    refetch,
  } = useJobAgent();

  const { jobs, loading: jobsLoading, searching, searchProgress, searchJobs, toggleSaved, clearAllJobs, deleteJob } = useJobs();
  const { primaryResume } = useResumes();
  const { preferences } = useJobPreferences();

  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  // ── Step 1: Find Jobs ──────────────────────────────────────────────────────
  const handleFindJobs = async () => {
    if (!primaryResume) {
      toast.error("Upload a resume first to find matching jobs.");
      return;
    }

    const parsedContent = primaryResume.parsed_content || {};
    const possibleTexts = [
      (parsedContent as any)?.rawText,
      (parsedContent as any)?.fullText,
      (parsedContent as any)?.text,
      (parsedContent as any)?.content,
      typeof parsedContent === "string" ? parsedContent : null,
    ].filter(Boolean);
    const fullText = possibleTexts.sort((a, b) => (b?.length || 0) - (a?.length || 0))[0] || "";

    const resumeData = {
      skills: primaryResume.skills || [],
      experienceYears: primaryResume.experience_years || 0,
      parsedContent,
      atsScore: primaryResume.ats_score || null,
      fullText,
    };

    const jobPrefs = {
      jobTitles: preferences?.job_titles || [],
      locations: preferences?.locations || [],
      remotePreference: preferences?.remote_preference || "any",
      salaryMin: preferences?.salary_min || null,
      salaryMax: preferences?.salary_max || null,
      industries: preferences?.industries || [],
    };

    setSelectedJobIds(new Set());
    await searchJobs(jobPrefs, resumeData);
  };

  // ── Step 2: Selection helpers ─────────────────────────────────────────────
  const toggleJob = (id: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedJobIds(new Set(jobs.map((j) => j.id)));
  const clearSelection = () => setSelectedJobIds(new Set());

  // ── Step 3: Apply to selected jobs ───────────────────────────────────────
  const handleApply = async () => {
    if (selectedJobIds.size === 0) {
      toast.error("Select at least one job to apply to.");
      return;
    }
    if (!primaryResume) {
      toast.error("No primary resume found.");
      return;
    }

    setIsApplying(true);
    const selectedJobs = jobs.filter((j) => selectedJobIds.has(j.id));
    let successCount = 0;
    let failCount = 0;

    for (const job of selectedJobs) {
      try {
        // Insert application with pending-apply status to trigger Skyvern workflow
        const { error } = await supabase.from("applications").insert({
          user_id: user!.id,
          job_id: job.id,
          resume_id: primaryResume.id,
          status: "pending-apply",
          platform: "other",
          company_name: job.company,
          job_title: job.title,
          job_url: job.url,
        });

        if (error) throw error;
        setAppliedIds((prev) => new Set([...prev, job.id]));
        successCount++;
      } catch (err: any) {
        console.error("Apply failed for", job.title, err);
        failCount++;
      }
    }

    setIsApplying(false);

    if (successCount > 0) {
      toast.success(
        `✅ Queued ${successCount} application${successCount > 1 ? "s" : ""}! The agent will apply in the background.`,
        { duration: 6000 }
      );
    }
    if (failCount > 0) {
      toast.error(`${failCount} application${failCount > 1 ? "s" : ""} failed to queue.`);
    }

    setSelectedJobIds(new Set());
  };

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
  const unappliedJobs = jobs.filter((j) => !appliedIds.has(j.id));

  return (
    <AppLayout>
      <div className="container max-w-5xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Job Agent</h1>
            <p className="text-muted-foreground">Find jobs, pick the ones you want, then apply.</p>
          </div>
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* ── Account Connections ──────────────────────────────────────── */}
        {!hasProfile && (
          <Card className="border-dashed border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Setup Your Job Agent
              </CardTitle>
              <CardDescription>
                Create a browser profile to save your login sessions. You only need to do this once.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => refetch()}>
                <Zap className="h-4 w-4 mr-2" />
                Create Browser Profile
              </Button>
            </CardContent>
          </Card>
        )}

        {hasProfile && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Connected Accounts</CardTitle>
              <CardDescription>Log in once — the agent uses these saved sessions to apply.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {SUPPORTED_SITES.map((site) => {
                  const isConnected = sitesLoggedIn.includes(site.key);
                  const Icon = site.icon;
                  const isPending = loginSession?.site === site.key;

                  return (
                    <div
                      key={site.key}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        isConnected ? "border-green-500 bg-green-500/10" : "border-muted hover:border-primary"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`p-1.5 rounded-full ${site.color}`}>
                          <Icon className="h-3.5 w-3.5 text-white" />
                        </div>
                        <span className="font-medium text-sm">{site.name}</span>
                      </div>

                      {isConnected ? (
                        <Badge variant="outline" className="text-success border-success text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                      ) : isPending ? (
                        <div className="space-y-1.5">
                          {loginSession?.liveViewUrl && (
                            <Button size="sm" variant="outline" asChild className="w-full text-xs h-7">
                              <a href={loginSession.liveViewUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Open Browser
                              </a>
                            </Button>
                          )}
                          <Button size="sm" className="w-full text-xs h-7" onClick={() => confirmLogin(site.key)}>
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            I'm Logged In
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full text-xs h-7"
                          onClick={() => startLogin(site.key)}
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

        {/* ── STEP 1: Find Jobs ─────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
                  Find Jobs
                </CardTitle>
                <CardDescription className="mt-1">
                  {!primaryResume
                    ? "Upload a resume first in the Resume tab."
                    : "Click to search for jobs matching your resume and preferences."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {jobs.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearAllJobs} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button onClick={handleFindJobs} disabled={searching || !primaryResume} size="lg" className="min-w-[140px]">
                  {searching ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {searchProgress.total > 0
                        ? `Batch ${searchProgress.current}/${searchProgress.total}`
                        : "Searching..."}
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      Find Jobs
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* ── STEP 2 + 3: Job List with Selection & Apply ───────────────── */}
        {(jobs.length > 0 || jobsLoading) && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
                    Select Jobs
                    {jobs.length > 0 && (
                      <Badge variant="secondary" className="ml-1">{jobs.length} found</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Check the jobs you want to apply to, then click Apply.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {selectedJobIds.size > 0 && (
                    <span className="text-sm text-muted-foreground">{selectedJobIds.size} selected</span>
                  )}
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    Select All
                  </Button>
                  {selectedJobIds.size > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearSelection}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-0">
              {jobsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 bg-secondary rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {jobs.map((job) => {
                    const isSelected = selectedJobIds.has(job.id);
                    const isApplied = appliedIds.has(job.id);
                    const isExpanded = expandedJobId === job.id;

                    return (
                      <div
                        key={job.id}
                        className={`rounded-lg border transition-all duration-150 ${
                          isApplied
                            ? "border-success/40 bg-success/5 opacity-70"
                            : isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <div className="flex items-start gap-3 p-4">
                          {/* Checkbox */}
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => !isApplied && toggleJob(job.id)}
                            disabled={isApplied}
                            className="mt-0.5 shrink-0"
                          />

                          {/* Job info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h3 className="font-medium text-foreground text-sm">{job.title}</h3>
                                  {isApplied && (
                                    <Badge variant="outline" className="text-success border-success text-xs">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      Queued
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground">{job.company}</p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {job.match_score && (
                                  <div
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                      job.match_score >= 90
                                        ? "bg-success/20 text-success"
                                        : job.match_score >= 75
                                        ? "bg-success/10 text-success"
                                        : job.match_score >= 60
                                        ? "bg-warning/10 text-warning"
                                        : "bg-muted text-muted-foreground"
                                    }`}
                                  >
                                    {job.match_score}% match
                                  </div>
                                )}
                                <button
                                  onClick={() => toggleSaved(job.id)}
                                  className="p-1 hover:bg-secondary rounded"
                                >
                                  <Heart
                                    className={`w-3.5 h-3.5 ${job.is_saved ? "fill-destructive text-destructive" : "text-muted-foreground"}`}
                                  />
                                </button>
                                {job.url && (
                                  <a href={job.url} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-secondary rounded">
                                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                                  </a>
                                )}
                                <button
                                  onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                                  className="p-1 hover:bg-secondary rounded"
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                  )}
                                </button>
                                <button
                                  onClick={() => deleteJob(job.id)}
                                  className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-destructive"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Quick meta */}
                            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                              {job.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3 h-3" /> {job.location}
                                </span>
                              )}
                              {(job.salary_min || job.salary_max) && (
                                <span className="flex items-center gap-1">
                                  <DollarSign className="w-3 h-3" />
                                  {job.salary_min && job.salary_max
                                    ? `$${(job.salary_min / 1000).toFixed(0)}k–$${(job.salary_max / 1000).toFixed(0)}k`
                                    : job.salary_min
                                    ? `$${(job.salary_min / 1000).toFixed(0)}k+`
                                    : `Up to $${(job.salary_max! / 1000).toFixed(0)}k`}
                                </span>
                              )}
                              {job.job_type && (
                                <span className="capitalize">{job.job_type}</span>
                              )}
                            </div>

                            {/* Skills */}
                            {job.requirements && job.requirements.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {job.requirements.slice(0, isExpanded ? 20 : 4).map((req) => (
                                  <Badge key={req} variant="secondary" className="text-xs px-1.5 py-0">
                                    {req}
                                  </Badge>
                                ))}
                                {!isExpanded && job.requirements.length > 4 && (
                                  <span className="text-xs text-muted-foreground self-center">
                                    +{job.requirements.length - 4} more
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Expanded description */}
                            {isExpanded && job.description && (
                              <p className="mt-3 text-xs text-muted-foreground leading-relaxed line-clamp-6">
                                {job.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── STEP 3: Apply ─────────────────────────────────────────────── */}
        {jobs.length > 0 && (
          <Card className={`border-2 transition-all ${selectedJobIds.size > 0 ? "border-primary bg-primary/5" : "border-muted"}`}>
            <CardContent className="py-5">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
                    Apply to Selected
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {selectedJobIds.size === 0
                      ? "Select jobs above to apply."
                      : `Ready to apply to ${selectedJobIds.size} job${selectedJobIds.size > 1 ? "s" : ""}. The agent will handle form submission in the background.`}
                  </p>
                </div>
                <Button
                  size="lg"
                  onClick={handleApply}
                  disabled={selectedJobIds.size === 0 || isApplying}
                  className="min-w-[160px]"
                >
                  {isApplying ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Queuing...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Apply ({selectedJobIds.size})
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
