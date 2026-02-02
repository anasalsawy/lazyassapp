import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useResumes } from "@/hooks/useResumes";
import { 
  FileText, Upload, Trash2, Star, Loader2, 
  Sparkles, CheckCircle2, AlertCircle 
} from "lucide-react";
import { cn } from "@/lib/utils";

const Resume = () => {
  const { 
    resumes, 
    loading, 
    uploadResume, 
    deleteResume, 
    analyzeResume, 
    updateResume 
  } = useResumes();
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const handleFileUpload = async (file: File) => {
    await uploadResume(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      await handleFileUpload(file);
    }
  };

  const handleAnalyze = async (resumeId: string) => {
    setAnalyzing(resumeId);
    try {
      // Use the pasted text or a placeholder
      const textToAnalyze = resumeText || `
        Experienced software engineer with 5+ years in web development.
        Skills: React, TypeScript, Node.js, Python, AWS, PostgreSQL
        Previously at Google and Meta. Led teams of 5-10 engineers.
        Increased application performance by 40%.
        BS in Computer Science from Stanford.
      `;
      await analyzeResume(resumeId, textToAnalyze);
    } finally {
      setAnalyzing(null);
    }
  };

  const handleSetPrimary = async (resumeId: string) => {
    // First, unset all as primary
    for (const resume of resumes) {
      if (resume.is_primary) {
        await updateResume(resume.id, { is_primary: false });
      }
    }
    // Then set the selected one as primary
    await updateResume(resumeId, { is_primary: true });
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
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Resume Manager</h1>
        <p className="text-muted-foreground mt-1">
          Upload, optimize, and manage your resumes
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <div className="space-y-6">
          <div
            className={cn(
              "glass-card rounded-2xl p-8 border-2 border-dashed transition-all duration-200",
              isDragging ? "border-primary bg-primary/5" : "border-border"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Upload Resume</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Drag and drop or click to browse (PDF, DOC, DOCX)
              </p>
              <label>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                />
                <Button variant="outline" className="cursor-pointer" asChild>
                  <span>Choose File</span>
                </Button>
              </label>
            </div>
          </div>

          {/* Text Input for Analysis */}
          <div className="glass-card rounded-2xl p-6">
            <h3 className="font-semibold text-foreground mb-4">Or Paste Resume Text</h3>
            <Textarea
              placeholder="Paste your resume content here for AI analysis..."
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              className="min-h-[200px] mb-4"
            />
            <p className="text-xs text-muted-foreground">
              Paste your resume text to get AI-powered analysis and optimization suggestions.
            </p>
          </div>
        </div>

        {/* Resumes List */}
        <div className="space-y-4">
          <h3 className="font-semibold text-foreground">Your Resumes ({resumes.length})</h3>
          
          {resumes.length === 0 ? (
            <div className="glass-card rounded-2xl p-8 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No resumes uploaded yet</p>
            </div>
          ) : (
            resumes.map((resume) => (
              <div
                key={resume.id}
                className={cn(
                  "glass-card rounded-2xl p-6 transition-all duration-200",
                  resume.is_primary && "ring-2 ring-primary"
                )}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-foreground">{resume.title}</h4>
                        {resume.is_primary && (
                          <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                            Primary
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {resume.original_filename || "Resume"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!resume.is_primary && (
                      <button
                        onClick={() => handleSetPrimary(resume.id)}
                        className="p-2 hover:bg-secondary rounded-lg"
                        title="Set as primary"
                      >
                        <Star className="w-4 h-4 text-muted-foreground" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteResume(resume.id)}
                      className="p-2 hover:bg-destructive/10 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </button>
                  </div>
                </div>

                {/* ATS Score */}
                {resume.ats_score !== null && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">ATS Score</span>
                      <span className={cn(
                        "font-bold",
                        resume.ats_score >= 80 ? "text-success" :
                        resume.ats_score >= 60 ? "text-warning" : "text-destructive"
                      )}>
                        {resume.ats_score}%
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          resume.ats_score >= 80 ? "bg-success" :
                          resume.ats_score >= 60 ? "bg-warning" : "bg-destructive"
                        )}
                        style={{ width: `${resume.ats_score}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Skills */}
                {resume.skills && resume.skills.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm text-muted-foreground mb-2">Skills</p>
                    <div className="flex flex-wrap gap-2">
                      {resume.skills.slice(0, 8).map((skill) => (
                        <span
                          key={skill}
                          className="px-2 py-1 bg-secondary text-xs rounded-full"
                        >
                          {skill}
                        </span>
                      ))}
                      {resume.skills.length > 8 && (
                        <span className="px-2 py-1 text-muted-foreground text-xs">
                          +{resume.skills.length - 8} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Analysis Status */}
                {resume.ats_score === null ? (
                  <div className="flex items-center gap-2 p-3 bg-warning/5 border border-warning/20 rounded-lg mb-4">
                    <AlertCircle className="w-4 h-4 text-warning" />
                    <span className="text-sm text-warning">Not analyzed yet</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 bg-success/5 border border-success/20 rounded-lg mb-4">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="text-sm text-success">AI analysis complete</span>
                  </div>
                )}

                <Button
                  className="w-full"
                  variant={resume.ats_score ? "outline" : "default"}
                  onClick={() => handleAnalyze(resume.id)}
                  disabled={analyzing === resume.id}
                >
                  {analyzing === resume.id ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      {resume.ats_score ? "Re-analyze" : "Analyze with AI"}
                    </>
                  )}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Resume;
