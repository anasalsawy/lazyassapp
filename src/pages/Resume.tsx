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
  Star
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
}

export default function Resume() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [resumes, setResumes] = useState<Resume[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

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
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from("resumes")
        .insert({
          user_id: user?.id,
          title: file.name.replace(/\.[^/.]+$/, ""),
          file_path: filePath,
          original_filename: file.name,
          is_primary: resumes.length === 0,
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

  const handleOptimize = async (resumeId: string) => {
    setIsOptimizing(true);
    try {
      const { error } = await supabase.functions.invoke("analyze-resume", {
        body: { resumeId },
      });

      if (error) throw error;
      toast({ title: "Resume optimized!", description: "Keywords and formatting have been improved." });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Optimization failed", description: error.message, variant: "destructive" });
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleSetPrimary = async (resumeId: string) => {
    try {
      // Unset all as primary
      await supabase
        .from("resumes")
        .update({ is_primary: false })
        .eq("user_id", user?.id);

      // Set selected as primary
      await supabase
        .from("resumes")
        .update({ is_primary: true })
        .eq("id", resumeId);

      toast({ title: "Primary resume updated" });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async (resumeId: string, filePath: string | null) => {
    try {
      if (filePath) {
        await supabase.storage.from("resumes").remove([filePath]);
      }
      await supabase.from("resumes").delete().eq("id", resumeId);
      toast({ title: "Resume deleted" });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDownload = async (filePath: string, filename: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("resumes")
        .download(filePath);

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
            <p className="text-muted-foreground">Manage and optimize your resumes</p>
          </div>
          <div>
            <input
              type="file"
              id="resume-upload"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={handleUpload}
            />
            <Button onClick={() => document.getElementById("resume-upload")?.click()} disabled={isUploading}>
              {isUploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload Resume
            </Button>
          </div>
        </div>

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
                            <Badge variant="secondary" className="gap-1">
                              <Star className="w-3 h-3" />
                              Primary
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {resume.original_filename} • Updated {formatDistanceToNow(new Date(resume.updated_at), { addSuffix: true })}
                        </p>
                        {resume.ats_score && (
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-success">
                              ATS Score: {resume.ats_score}%
                            </Badge>
                          </div>
                        )}
                        {resume.skills && resume.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {resume.skills.slice(0, 5).map((skill) => (
                              <Badge key={skill} variant="secondary" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                            {resume.skills.length > 5 && (
                              <Badge variant="secondary" className="text-xs">
                                +{resume.skills.length - 5} more
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {!resume.is_primary && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetPrimary(resume.id)}
                        >
                          <Star className="w-4 h-4 mr-1" />
                          Set Primary
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOptimize(resume.id)}
                        disabled={isOptimizing}
                      >
                        {isOptimizing ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-1" />
                        )}
                        Optimize
                      </Button>
                      {resume.file_path && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(resume.file_path!, resume.original_filename || "resume.pdf")}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(resume.id, resume.file_path)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
