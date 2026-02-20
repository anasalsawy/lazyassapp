import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Download,
  Sparkles,
  Loader2,
  Upload,
  Trash2,
  Star,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  X,
  Copy,
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
  finalScore: number;
  qualityGatePassed: boolean;
  rounds: number;
  optimizedResume: any;
  htmlPreview: string;
  atsText: string;
  researchChecklist: any;
  lastCriticFeedback: any;
}

interface OptimizingState {
  resumeId: string;
  stage: "researcher" | "writer" | "critic" | "designer" | "done";
  round: number;
  score: number;
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
  const [previewResumeId, setPreviewResumeId] = useState<string | null>(null);

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

      // Re-load any stored optimization results
      const results: { [id: string]: OptimizationResult } = {};
      for (const r of data || []) {
        const pc = r.parsed_content as any;
        if (pc?.optimized && pc?.finalScore !== undefined) {
          results[r.id] = {
            finalScore: pc.finalScore,
            qualityGatePassed: pc.finalScore >= 90,
            rounds: pc.optimizationRounds || 0,
            optimizedResume: pc.optimized,
            htmlPreview: pc.optimizedHtml || "",
            atsText: pc.optimizedAtsText || "",
            researchChecklist: pc.researchChecklist,
            lastCriticFeedback: null,
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

      // Immediately extract text so pipeline can use it
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

      toast({ title: "Resume uploaded!", description: "Click Optimize to run the full AI pipeline." });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleOptimize = async (resumeId: string) => {
    setOptimizingState({ resumeId, stage: "researcher", round: 0, score: 0 });
    setOptimizationResult((prev) => {
      const next = { ...prev };
      delete next[resumeId];
      return next;
    });

    try {
      // Animate through stages optimistically
      const stageTimings: Array<[OptimizingState["stage"], number]> = [
        ["researcher", 4000],
        ["writer", 8000],
        ["critic", 8000],
      ];

      let delay = 0;
      for (const [stage, ms] of stageTimings) {
        delay += ms;
        setTimeout(() => {
          setOptimizingState((prev) =>
            prev?.resumeId === resumeId ? { ...prev, stage } : prev
          );
        }, delay);
      }

      const { data, error } = await supabase.functions.invoke("optimize-resume", {
        body: { resumeId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setOptimizationResult((prev) => ({ ...prev, [resumeId]: data as OptimizationResult }));
      setOptimizingState({ resumeId, stage: "done", round: data.rounds, score: data.finalScore });
      setExpandedResult(resumeId);

      if (data.qualityGatePassed) {
        toast({
          title: `✅ Quality gate passed! Score: ${data.finalScore}`,
          description: `${data.rounds} round(s) of Writer ↔ Critic optimization.`,
        });
      } else {
        toast({
          title: `⚠️ Optimization complete. Score: ${data.finalScore}`,
          description: `Pipeline ran ${data.rounds} rounds but didn't reach 90. Check the feedback below.`,
          variant: "destructive",
        });
      }

      fetchResumes();
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

  const isOptimizing = (id: string) =>
    optimizingState?.resumeId === id && optimizingState.stage !== "done";

  const stageLabel = (stage: OptimizingState["stage"]) => {
    switch (stage) {
      case "researcher": return "🔬 Researcher building checklist…";
      case "writer":     return "✍️ Writer optimizing content…";
      case "critic":     return "🎯 Critic auditing & scoring…";
      case "designer":   return "🎨 Designer formatting output…";
      case "done":       return "✅ Done";
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
    <AppLayout>
      <div className="container max-w-4xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">My Resumes</h1>
            <p className="text-muted-foreground">
              Upload, then run the full AI pipeline: Researcher → Writer ↔ Critic (90+ gate) → Designer
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
              <span className="font-semibold text-primary">Optimization Pipeline:</span>
              {["🔬 Researcher", "✍️ Writer", "🎯 Critic", "🔄 Loop until 90+", "🎨 Designer"].map((step, i) => (
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
              const optimizing = optimizingState?.resumeId === resume.id && optimizingState.stage !== "done";
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
                              <Badge
                                variant={result.qualityGatePassed ? "secondary" : "outline"}
                                className={result.qualityGatePassed ? "text-success bg-success/10" : "text-warning bg-warning/10"}
                              >
                                {result.qualityGatePassed ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                                Score: {result.finalScore} · {result.rounds} round{result.rounds !== 1 ? "s" : ""}
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setExpandedResult(expandedResult === resume.id ? null : resume.id)}
                          >
                            {expandedResult === resume.id ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                            Results
                          </Button>
                        )}
                        {resume.file_path && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(resume.file_path!, resume.original_filename || "resume.pdf")}
                          >
                            <Download className="w-4 h-4" />
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
                        <div className="flex items-center gap-2 mb-2">
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          <span className="text-sm font-medium">{stageLabel(currentState.stage)}</span>
                        </div>
                        <div className="flex gap-2 mt-2">
                          {(["researcher", "writer", "critic"] as const).map((s) => (
                            <div
                              key={s}
                              className={`h-1.5 flex-1 rounded-full transition-all ${
                                currentState.stage === s
                                  ? "bg-primary animate-pulse"
                                  : ["researcher", "writer", "critic"].indexOf(currentState.stage) >
                                    ["researcher", "writer", "critic"].indexOf(s)
                                  ? "bg-primary"
                                  : "bg-muted"
                              }`}
                            />
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Writer ↔ Critic loop runs until score ≥ 90 or 20 rounds max
                        </p>
                      </div>
                    )}

                    {/* Optimization results */}
                    {result && expandedResult === resume.id && (
                      <div className="mt-4 space-y-4">
                        {/* Score */}
                        <div className="p-4 rounded-lg border bg-card">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-sm">Final ATS Score</span>
                            <span className={`text-2xl font-bold ${result.finalScore >= 90 ? "text-success" : result.finalScore >= 70 ? "text-warning" : "text-destructive"}`}>
                              {result.finalScore}
                            </span>
                          </div>
                          <Progress value={result.finalScore} className="h-2" />
                          <p className="text-xs text-muted-foreground mt-1">
                            {result.qualityGatePassed ? "✅ Quality gate (90+) passed" : "⚠️ Below quality gate — consider re-optimizing"}
                            {" · "}{result.rounds} round{result.rounds !== 1 ? "s" : ""} of Writer ↔ Critic
                          </p>
                        </div>

                        {/* Checklist */}
                        {result.researchChecklist && (
                          <div className="p-4 rounded-lg border bg-card">
                            <p className="font-semibold text-sm mb-2">🔬 Researcher Output</p>
                            <p className="text-xs text-muted-foreground mb-1">Target role: <span className="text-foreground font-medium">{result.researchChecklist.targetRole}</span></p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {(result.researchChecklist.topKeywords || []).slice(0, 12).map((k: string) => (
                                <Badge key={k} variant="outline" className="text-xs">{k}</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Critic feedback */}
                        {result.lastCriticFeedback && (
                          <div className="p-4 rounded-lg border bg-card">
                            <p className="font-semibold text-sm mb-2">🎯 Critic Final Feedback</p>
                            {result.lastCriticFeedback.strengths?.length > 0 && (
                              <div className="mb-2">
                                <p className="text-xs font-medium text-success mb-1">Strengths</p>
                                <ul className="text-xs space-y-0.5">
                                  {result.lastCriticFeedback.strengths.map((s: string, i: number) => (
                                    <li key={i} className="text-muted-foreground">• {s}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {result.lastCriticFeedback.critical_failures?.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-destructive mb-1">Critical failures</p>
                                <ul className="text-xs space-y-0.5">
                                  {result.lastCriticFeedback.critical_failures.map((f: string, i: number) => (
                                    <li key={i} className="text-muted-foreground">• {f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Resume viewer tabs */}
                        {(result.atsText || result.htmlPreview) && (
                          <div className="rounded-lg border bg-card overflow-hidden">
                            <Tabs defaultValue={result.htmlPreview ? "preview" : "ats"}>
                              <div className="flex items-center justify-between px-4 pt-3 pb-0 border-b">
                                <TabsList className="h-8">
                                  {result.htmlPreview && (
                                    <TabsTrigger value="preview" className="text-xs gap-1">
                                      <Eye className="w-3 h-3" /> Formatted Resume
                                    </TabsTrigger>
                                  )}
                                  {result.atsText && (
                                    <TabsTrigger value="ats" className="text-xs gap-1">
                                      <FileText className="w-3 h-3" /> ATS Plain Text
                                    </TabsTrigger>
                                  )}
                                </TabsList>
                                <div className="flex gap-2 pb-1">
                                  {result.htmlPreview && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() => setPreviewResumeId(resume.id)}
                                    >
                                      <Eye className="w-3 h-3 mr-1" />
                                      Full Screen
                                    </Button>
                                  )}
                                  {result.atsText && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() => {
                                        const blob = new Blob([result.atsText], { type: "text/plain" });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = `${resume.title}_optimized.txt`;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                      }}
                                    >
                                      <Download className="w-3 h-3 mr-1" />
                                      Download ATS
                                    </Button>
                                  )}
                                  {result.htmlPreview && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() => {
                                        const blob = new Blob([result.htmlPreview], { type: "text/html" });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = `${resume.title}_optimized.html`;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                      }}
                                    >
                                      <Download className="w-3 h-3 mr-1" />
                                      Download HTML
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {result.htmlPreview && (
                                <TabsContent value="preview" className="m-0">
                                  <div className="h-[500px] overflow-auto bg-white">
                                    <iframe
                                      srcDoc={result.htmlPreview}
                                      className="w-full h-full border-0"
                                      title="Optimized Resume Preview"
                                      sandbox="allow-same-origin"
                                    />
                                  </div>
                                </TabsContent>
                              )}

                              {result.atsText && (
                                <TabsContent value="ats" className="m-0">
                                  <div className="relative">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="absolute top-2 right-2 h-7 text-xs z-10"
                                      onClick={() => {
                                        navigator.clipboard.writeText(result.atsText);
                                        toast({ title: "Copied to clipboard!" });
                                      }}
                                    >
                                      <Copy className="w-3 h-3 mr-1" />
                                      Copy
                                    </Button>
                                    <pre className="text-xs text-foreground whitespace-pre-wrap p-4 font-mono h-[500px] overflow-auto bg-muted/30">
                                      {result.atsText}
                                    </pre>
                                  </div>
                                </TabsContent>
                              )}
                            </Tabs>
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

        {/* Full Screen HTML Preview Modal */}
        {previewResumeId && optimizationResult[previewResumeId]?.htmlPreview && (
          <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
            <div className="flex items-center justify-between bg-background px-4 py-3 border-b shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">Optimized Resume — Full Preview</span>
                <Badge variant="secondary" className="text-success bg-success/10">
                  Score: {optimizationResult[previewResumeId].finalScore}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const res = optimizationResult[previewResumeId];
                    const blob = new Blob([res.htmlPreview], { type: "text/html" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "optimized_resume.html";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="w-4 h-4 mr-1" />
                  Download HTML
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPreviewResumeId(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 bg-muted overflow-hidden">
              <iframe
                srcDoc={optimizationResult[previewResumeId].htmlPreview}
                className="w-full h-full border-0"
                title="Full Resume Preview"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
