import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      fetchResumes();
    }
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
                        {result && (
                          <>
                            <Button
                              variant="default"
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white"
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
                              <Download className="w-4 h-4 mr-1" />
                              Optimized
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setExpandedResult(expandedResult === resume.id ? null : resume.id)}
                            >
                              {expandedResult === resume.id ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                              Preview
                            </Button>
                          </>
                        )}
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
                      <div className="mt-4 p-4 rounded-lg bg-muted/50 border">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                            <span className="text-sm font-medium">
                              🤖 Agent is optimizing your resume via ChatGPT Deep Research…
                            </span>
                          </div>
                          {currentState.recording_url && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              onClick={() => window.open(currentState.recording_url!, "_blank")}
                            >
                              <Eye className="w-3 h-3" />
                              Watch Live
                            </Button>
                          )}
                        </div>
                        {currentState.total_steps && currentState.completed_steps !== undefined && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Step {currentState.completed_steps} / {currentState.total_steps}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          This may take a few minutes — the agent navigates ChatGPT and uses Deep Research mode
                        </p>
                      </div>
                    )}

                    {/* Optimization results */}
                    {result && expandedResult === resume.id && (
                      <div className="mt-4 space-y-4">
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
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  navigator.clipboard.writeText(result.optimizedText);
                                  toast({ title: "Copied to clipboard!" });
                                }}
                              >
                                <Copy className="w-3 h-3 mr-1" />
                                Copy
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
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
                                <Download className="w-3 h-3 mr-1" />
                                Download
                              </Button>
                            </div>
                          </div>
                          <div className="relative">
                            <pre className="text-sm text-foreground whitespace-pre-wrap p-4 font-mono max-h-[600px] overflow-auto bg-muted/30">
                              {result.optimizedText}
                            </pre>
                          </div>
                        </div>
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
