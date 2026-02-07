import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useResumeOptimizer } from "@/hooks/useResumeOptimizer";
import { OptimizeDialog } from "@/components/resume/OptimizeDialog";
import { OptimizationProgress } from "@/components/resume/OptimizationProgress";
import { OptimizationResultView } from "@/components/resume/OptimizationResultView";
import {
  FileText, Download, Sparkles, Loader2, Upload, Trash2, Star,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ResumeRecord {
  id: string;
  title: string;
  file_path: string | null;
  original_filename: string | null;
  is_primary: boolean;
  ats_score: number | null;
  skills: string[] | null;
  created_at: string;
  updated_at: string;
}

export default function Resume() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [optimizeDialogOpen, setOptimizeDialogOpen] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [selectedResumeTitle, setSelectedResumeTitle] = useState("");

  const optimizer = useResumeOptimizer();

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
    else if (user) fetchResumes();
  }, [user, authLoading]);

  const fetchResumes = async () => {
    try {
      const { data, error } = await supabase
        .from("resumes").select("*").eq("user_id", user?.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setResumes(data || []);
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
        user_id: user?.id, title: file.name.replace(/\.[^/.]+$/, ""),
        file_path: filePath, original_filename: file.name, is_primary: resumes.length === 0,
      });
      if (dbError) throw dbError;
      toast({ title: "Resume uploaded!", description: "You can now optimize it with AI." });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartOptimize = (resumeId: string, title: string) => {
    setSelectedResumeId(resumeId);
    setSelectedResumeTitle(title);
    setOptimizeDialogOpen(true);
  };

  const handleOptimize = (targetRole: string, location: string, manualMode: boolean) => {
    if (!selectedResumeId) return;
    setOptimizeDialogOpen(false);
    optimizer.optimize(selectedResumeId, targetRole, location, manualMode);
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
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: "Download failed", description: error.message, variant: "destructive" });
    }
  };

  const downloadText = () => {
    if (!optimizer.result?.ats_text) return;
    const blob = new Blob([optimizer.result.ats_text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "resume_ats.txt"; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadHtml = () => {
    if (!optimizer.result?.html) return;
    const blob = new Blob([optimizer.result.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "resume.html"; a.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show optimization progress or paused state
  if (optimizer.status === "running" || optimizer.status === "awaiting_continue") {
    return (
      <AppLayout>
        <div className="container max-w-3xl mx-auto py-8 px-4">
          <OptimizationProgress
            progress={optimizer.progress}
            currentStep={optimizer.currentStep}
            currentRound={optimizer.currentRound}
            latestScorecard={optimizer.latestScorecard}
            gatekeeperVerdicts={optimizer.gatekeeperVerdicts}
            manualPause={optimizer.manualPause}
            onCancel={optimizer.cancel}
            onContinue={optimizer.continueOptimization}
          />
        </div>
      </AppLayout>
    );
  }

  if (optimizer.status === "complete" && optimizer.result) {
    return (
      <AppLayout>
        <div className="container max-w-4xl mx-auto py-8 px-4">
          <OptimizationResultView
            result={optimizer.result}
            onReset={() => { optimizer.reset(); fetchResumes(); }}
            onDownloadText={downloadText}
            onDownloadHtml={downloadHtml}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">My Resumes</h1>
            <p className="text-muted-foreground">Manage and optimize your resumes</p>
          </div>
          <div>
            <input type="file" id="resume-upload" accept=".pdf,.doc,.docx" className="hidden" onChange={handleUpload} />
            <Button onClick={() => document.getElementById("resume-upload")?.click()} disabled={isUploading}>
              {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload Resume
            </Button>
          </div>
        </div>

        {resumes.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No resumes yet</h3>
              <p className="text-muted-foreground mb-4">Upload your resume to get started</p>
              <Button onClick={() => document.getElementById("resume-upload")?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Upload Resume
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {resumes.map((resume) => (
              <Card key={resume.id} className={resume.is_primary ? "border-primary" : ""}>
                <CardContent className="py-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <FileText className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{resume.title}</h3>
                          {resume.is_primary && (
                            <Badge variant="secondary" className="gap-1"><Star className="w-3 h-3" /> Primary</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {resume.original_filename} • Updated {formatDistanceToNow(new Date(resume.updated_at), { addSuffix: true })}
                        </p>
                        {resume.ats_score && (
                          <Badge variant="outline" className="text-success mt-1">ATS Score: {resume.ats_score}%</Badge>
                        )}
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
                    <div className="flex items-center gap-2">
                      {!resume.is_primary && (
                        <Button variant="outline" size="sm" onClick={() => handleSetPrimary(resume.id)}>
                          <Star className="w-4 h-4 mr-1" /> Set Primary
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => handleStartOptimize(resume.id, resume.title)}>
                        <Sparkles className="w-4 h-4 mr-1" /> Optimize
                      </Button>
                      {resume.file_path && (
                        <Button variant="outline" size="sm" onClick={() => handleDownload(resume.file_path!, resume.original_filename || "resume.pdf")}>
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(resume.id, resume.file_path)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <OptimizeDialog
          open={optimizeDialogOpen}
          onOpenChange={setOptimizeDialogOpen}
          onStart={handleOptimize}
          isRunning={false}
          resumeTitle={selectedResumeTitle}
        />
      </div>
    </AppLayout>
  );
}
