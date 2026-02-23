import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Download,
  Sparkles,
  Loader2,
  Upload,
  Trash2,
  Star,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  X,
  Copy,
  ExternalLink,
  Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Resume {
  id: string;
  title: string;
  file_path: string | null;
  original_filename: string | null;
  is_primary: boolean;
  ats_score: number | null;
  skills: string[] | null;
  created_at: string;
  updated_at: string;
  parsed_content: any;
}

interface OptimizationResult {
  optimizedText: string;
  recording_url?: string | null;
}

interface OptimizingState {
  resumeId: string;
  stage: string;
  skyvern_status?: string;
  total_steps?: number;
  completed_steps?: number;
  recording_url?: string | null;
}

export default function Resume() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [resumes, setResumes] = useState<Resume[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [optimizingState, setOptimizingState] = useState<OptimizingState | null>(null);
  const [optimizationResult, setOptimizationResult] = useState<{ [resumeId: string]: OptimizationResult }>({});
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer for elapsed time during optimization
  useEffect(() => {
    if (optimizingState) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [optimizingState?.resumeId]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      fetchResumes();
    }
  }, [user, authLoading]);

  // Resume polling for any in-progress optimization tasks on page load
  useEffect(() => {
    if (!user || authLoading) return;

    const checkRunningTasks = async () => {
      try {
        const { data: tasks } = await supabase
          .from("agent_tasks")
          .select("id, payload, result")
          .eq("user_id", user.id)
          .eq("task_type", "optimize_resume")
          .eq("status", "running")
          .order("created_at", { ascending: false })
          .limit(1);

        if (!tasks || tasks.length === 0) return;

        const task = tasks[0];
        const payload = task.payload as any;
        const resumeId = payload?.resumeId;
        if (!resumeId) return;

        // Already polling this one
        if (optimizingState?.resumeId === resumeId) return;

        const r = task.result as any;
        setOptimizingState({
          resumeId,
          stage: r?.stage || "optimizing",
          skyvern_status: r?.skyvern_status,
          total_steps: r?.total_steps,
          completed_steps: r?.completed_steps,
          recording_url: r?.recording_url,
        });

        // Start polling
        let pollCount = 0;
        const maxPolls = 300;
        const pollInterval = setInterval(async () => {
          pollCount++;
          if (pollCount > maxPolls) {
            clearInterval(pollInterval);
            toast({ title: "Optimization timed out", variant: "destructive" });
            setOptimizingState(null);
            return;
          }

          try {
            const { data: pollData } = await supabase.functions.invoke("optimize-resume", {
              body: { resumeId, action: "poll" },
            });

            if (!pollData) return;

            if (pollData.status === "running" && pollData.result) {
              const pr = pollData.result;
              setOptimizingState({
                resumeId,
                stage: pr.stage || "optimizing",
                skyvern_status: pr.skyvern_status,
                total_steps: pr.total_steps,
                completed_steps: pr.completed_steps,
                recording_url: pr.recording_url,
              });
            }

            if (pollData.status === "completed" && pollData.result) {
              clearInterval(pollInterval);
              const pr = pollData.result;
              setOptimizationResult((prev) => ({
                ...prev,
                [resumeId]: {
                  optimizedText: pr.optimizedText || "",
                  recording_url: pr.recording_url,
                },
              }));
              setOptimizingState(null);
              setExpandedResult(resumeId);
              toast({ title: "✅ Resume optimized!", description: "ChatGPT Deep Research has finished optimizing your resume." });
              fetchResumes();
            }

            if (pollData.status === "failed") {
              clearInterval(pollInterval);
              toast({ title: "Optimization failed", description: pollData.error || "Unknown error", variant: "destructive" });
              setOptimizingState(null);
            }
          } catch {
            // Ignore transient poll errors
          }
        }, 3000);

        return () => clearInterval(pollInterval);
      } catch (e) {
        console.error("Error checking running tasks:", e);
      }
    };

    checkRunningTasks();
  }, [user, authLoading]);

  const fetchResumes = async () => {
    try {
      const { data, error } = await supabase
        .from("resumes")
        .select("*")
        .eq("user_id", user?.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setResumes(data || []);

      // Load stored optimization results
      const results: { [id: string]: OptimizationResult } = {};
      for (const r of data || []) {
        const pc = r.parsed_content as any;
        if (pc?.optimizedText) {
          results[r.id] = {
            optimizedText: pc.optimizedText,
          };
        }
      }
      setOptimizationResult(results);
    } catch (error: any) {
      console.error("Error fetching resumes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const filePath = `${user?.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("resumes").upload(filePath, file);
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from("resumes").insert({
        user_id: user?.id,
        title: file.name.replace(/\.[^/.]+$/, ""),
        file_path: filePath,
        original_filename: file.name,
        is_primary: resumes.length === 0,
      });
      if (dbError) throw dbError;

      // Extract text so optimization can use it
      const { data: newResume } = await supabase
        .from("resumes")
        .select("id")
        .eq("user_id", user?.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (newResume) {
        await supabase.functions.invoke("analyze-resume", { body: { resumeId: newResume.id } });
      }

      toast({ title: "Resume uploaded!", description: "Click Optimize to run AI optimization via ChatGPT Deep Research." });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleOptimize = async (resumeId: string) => {
    setOptimizingState({ resumeId, stage: "optimizing" });
    setOptimizationResult((prev) => {
      const next = { ...prev };
      delete next[resumeId];
      return next;
    });

    try {
      const { data, error } = await supabase.functions.invoke("optimize-resume", {
        body: { resumeId, action: "start" },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Poll for completion
      let pollCount = 0;
      const maxPolls = 300; // 15 min max (Skyvern workflows can take a while)
      const pollInterval = setInterval(async () => {
        pollCount++;
        if (pollCount > maxPolls) {
          clearInterval(pollInterval);
          toast({ title: "Optimization timed out", description: "The workflow took too long. Check Agent Monitoring.", variant: "destructive" });
          setOptimizingState(null);
          return;
        }

        try {
          const { data: pollData } = await supabase.functions.invoke("optimize-resume", {
            body: { resumeId, action: "poll" },
          });

          if (!pollData) return;

          if (pollData.status === "running" && pollData.result) {
            const r = pollData.result;
            setOptimizingState({
              resumeId,
              stage: r.stage || "optimizing",
              skyvern_status: r.skyvern_status,
              total_steps: r.total_steps,
              completed_steps: r.completed_steps,
              recording_url: r.recording_url,
            });
          }

          if (pollData.status === "completed" && pollData.result) {
            clearInterval(pollInterval);
            const r = pollData.result;
            setOptimizationResult((prev) => ({
              ...prev,
              [resumeId]: {
                optimizedText: r.optimizedText || "",
                recording_url: r.recording_url,
              },
            }));
            setOptimizingState(null);
            setExpandedResult(resumeId);
            toast({ title: "✅ Resume optimized!", description: "ChatGPT Deep Research has finished optimizing your resume." });
            fetchResumes();
          }

          if (pollData.status === "failed") {
            clearInterval(pollInterval);
            toast({ title: "Optimization failed", description: pollData.error || "Unknown error", variant: "destructive" });
            setOptimizingState(null);
          }
        } catch {
          // Ignore transient poll errors
        }
      }, 3000);
    } catch (error: any) {
      toast({ title: "Optimization failed", description: error.message, variant: "destructive" });
      setOptimizingState(null);
    }
  };

  const handleSetPrimary = async (resumeId: string) => {
    try {
      await supabase.from("resumes").update({ is_primary: false }).eq("user_id", user?.id);
      await supabase.from("resumes").update({ is_primary: true }).eq("id", resumeId);
      toast({ title: "Primary resume updated" });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async (resumeId: string, filePath: string | null) => {
    try {
      if (filePath) await supabase.storage.from("resumes").remove([filePath]);
      await supabase.from("resumes").delete().eq("id", resumeId);
      toast({ title: "Resume deleted" });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDownload = async (filePath: string, filename: string) => {
    try {
      const { data, error } = await supabase.storage.from("resumes").download(filePath);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: "Download failed", description: error.message, variant: "destructive" });
    }
  };

  const isOptimizing = (id: string) => optimizingState?.resumeId === id;

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="container max-w-4xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">My Resumes</h1>
            <p className="text-muted-foreground">
              Upload your resume, then optimize it using ChatGPT Deep Research via our AI agent
            </p>
          </div>
          <div>
            <input
              type="file"
              id="resume-upload"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              onClick={() => document.getElementById("resume-upload")?.click()}
              disabled={isUploading}
            >
              {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload Resume
            </Button>
          </div>
        </div>

        {/* Pipeline info banner */}
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-2 items-center text-sm">
              <span className="font-semibold text-primary">Optimization:</span>
              {["📄 Upload Resume", "🤖 Agent Signs into ChatGPT", "🔬 Deep Research Mode", "✅ Optimized Resume"].map((step, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground">→</span>}
                  <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">{step}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Resumes List */}
        {resumes.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No resumes yet</h3>
              <p className="text-muted-foreground mb-4">Upload your resume to get started</p>
              <Button onClick={() => document.getElementById("resume-upload")?.click()}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Resume
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {resumes.map((resume) => {
              const result = optimizationResult[resume.id];
              const optimizing = isOptimizing(resume.id);
              const currentState = optimizingState?.resumeId === resume.id ? optimizingState : null;

              return (
                <Card key={resume.id} className={resume.is_primary ? "border-primary" : ""}>
                  <CardContent className="py-6">
                    {/* Main row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                          <FileText className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium">{resume.title}</h3>
                            {resume.is_primary && (
                              <Badge variant="secondary" className="gap-1">
                                <Star className="w-3 h-3" />
                                Primary
                              </Badge>
                            )}
                            {result && (
                              <Badge variant="secondary" className="text-green-600 bg-green-500/10">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                                Optimized

                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {resume.original_filename} · Updated {formatDistanceToNow(new Date(resume.updated_at), { addSuffix: true })}
                          </p>
                          {resume.skills && resume.skills.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {resume.skills.slice(0, 5).map((skill) => (
                                <Badge key={skill} variant="secondary" className="text-xs">{skill}</Badge>
                              ))}
                              {resume.skills.length > 5 && (
                                <Badge variant="secondary" className="text-xs">+{resume.skills.length - 5} more</Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {!resume.is_primary && (
                          <Button variant="outline" size="sm" onClick={() => handleSetPrimary(resume.id)}>
                            <Star className="w-4 h-4 mr-1" />
                            Set Primary
                          </Button>
                        )}
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleOptimize(resume.id)}
                          disabled={optimizing || !!optimizingState}
                        >
                          {optimizing ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4 mr-1" />
                          )}
                          {result ? "Re-optimize" : "Optimize"}
                        </Button>
                        {resume.file_path && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(resume.file_path!, resume.original_filename || "resume.pdf")}
                            title="Download original PDF"
                          >
                            <Download className="w-4 h-4 mr-1" />
                            <span className="text-xs text-muted-foreground">Original</span>
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(resume.id, resume.file_path)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    {/* Optimization progress */}
                    {optimizing && currentState && (
                      <div className="mt-4 p-5 rounded-xl bg-primary/5 border border-primary/20 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className="w-10 h-10 rounded-full border-2 border-primary/30 flex items-center justify-center">
                                <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                              </div>
                              <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full animate-ping" />
                            </div>
                            <div>
                              <p className="font-semibold text-sm">AI Agent is optimizing your resume</p>
                              <p className="text-xs text-muted-foreground">ChatGPT Deep Research mode active</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 bg-muted rounded-lg px-3 py-1.5">
                              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-sm font-mono font-medium tabular-nums">
                                {Math.floor(elapsedSeconds / 60).toString().padStart(2, "0")}:{(elapsedSeconds % 60).toString().padStart(2, "0")}
                              </span>
                            </div>
                            {currentState.recording_url && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => window.open(currentState.recording_url!, "_blank")}
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Watch Live
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Animated progress bar */}
                        <div className="space-y-1.5">
                          <Progress 
                            value={currentState.total_steps && currentState.completed_steps !== undefined 
                              ? Math.round((currentState.completed_steps / currentState.total_steps) * 100) 
                              : undefined} 
                            className="h-2" 
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            {currentState.total_steps && currentState.completed_steps !== undefined ? (
                              <span>Step {currentState.completed_steps} of {currentState.total_steps}</span>
                            ) : (
                              <span className="animate-pulse">Processing…</span>
                            )}
                            <span>~5–15 min typical</span>
                          </div>
                        </div>

                        {/* Stage indicators */}
                        <div className="flex gap-2">
                          {[
                            { key: "login", label: "Login", emoji: "🔑" },
                            { key: "research", label: "Deep Research", emoji: "🔬" },
                            { key: "extract", label: "Extract", emoji: "📄" },
                          ].map((s, i) => {
                            const stageOrder = ["login", "research", "extract"];
                            const currentIdx = currentState.stage === "optimizing" ? 1 : stageOrder.indexOf(currentState.stage);
                            const isActive = i === currentIdx;
                            const isDone = i < currentIdx;
                            return (
                              <div
                                key={s.key}
                                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                  isDone
                                    ? "bg-green-500/10 text-green-600"
                                    : isActive
                                    ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {isDone ? <CheckCircle2 className="w-3 h-3" /> : <span>{s.emoji}</span>}
                                {s.label}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Optimization results */}
                    {result && (
                      <div className="mt-4 space-y-4">
                        {/* Success banner with download CTA */}
                        <div className="rounded-xl bg-green-500/10 border border-green-500/30 p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                                <CheckCircle2 className="w-5 h-5 text-green-600" />
                              </div>
                              <div>
                                <p className="font-semibold text-green-700 dark:text-green-400">Resume optimized successfully!</p>
                                <p className="text-xs text-muted-foreground">AI-enhanced for ATS compatibility & recruiter appeal</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="lg"
                                className="bg-green-600 hover:bg-green-700 text-white gap-2 font-semibold shadow-lg shadow-green-600/20"
                                onClick={() => {
                                  const blob = new Blob([result.optimizedText], { type: "text/plain" });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = `${resume.title}_optimized.txt`;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }}
                              >
                                <Download className="w-5 h-5" />
                                Download Optimized Resume
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  navigator.clipboard.writeText(result.optimizedText);
                                  toast({ title: "Copied to clipboard!" });
                                }}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Expandable preview */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-center gap-2 text-muted-foreground"
                          onClick={() => setExpandedResult(expandedResult === resume.id ? null : resume.id)}
                        >
                          {expandedResult === resume.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          {expandedResult === resume.id ? "Hide Preview" : "Preview Optimized Content"}
                        </Button>

                        {expandedResult === resume.id && (
                          <div className="rounded-lg border bg-card overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 border-b">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-primary" />
                                <span className="font-semibold text-sm">Optimized Resume</span>
                              </div>
                              <div className="flex gap-2">
                                {result.recording_url && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => window.open(result.recording_url!, "_blank")}
                                  >
                                    <ExternalLink className="w-3 h-3 mr-1" />
                                    View Session
                                  </Button>
                                )}
                              </div>
                            </div>
                            <pre className="text-sm text-foreground whitespace-pre-wrap p-4 font-mono max-h-[600px] overflow-auto bg-muted/30">
                              {result.optimizedText}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
