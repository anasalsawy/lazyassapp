import { Button } from "@/components/ui/button";
import { Upload, FileText, CheckCircle2, AlertCircle, Trash2, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useResumes } from "@/hooks/useResumes";

export const ResumeUpload = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const { resumes, primaryResume, uploadResume, deleteResume, analyzeResume, loading } = useResumes();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "application/pdf" || file.type.includes("word"))) {
      await uploadResume(file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadResume(file);
    }
  };

  const handleAnalyze = async () => {
    if (!primaryResume) return;
    setAnalyzing(true);
    try {
      // For demo, use placeholder text. In production, you'd extract text from the file
      const mockResumeText = `
        John Doe - Software Engineer
        5 years of experience in React, TypeScript, Node.js
        Led team of 5 developers at TechCorp
        Increased performance by 40%
        Bachelor's in Computer Science
      `;
      await analyzeResume(primaryResume.id, mockResumeText);
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-secondary rounded w-1/3" />
          <div className="h-40 bg-secondary rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Your Resume</h2>
        {primaryResume && (
          <Button variant="outline" size="sm">
            View Resume
          </Button>
        )}
      </div>

      {!primaryResume ? (
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200",
            isDragging 
              ? "border-primary bg-primary/5" 
              : "border-border hover:border-primary/50"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Upload className="w-8 h-8 text-primary" />
          </div>
          <h3 className="font-medium text-foreground mb-2">
            Drop your resume here
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            or click to browse (PDF, DOC, DOCX)
          </p>
          <label>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx"
              onChange={handleFileChange}
            />
            <Button variant="outline" className="cursor-pointer" asChild>
              <span>Choose File</span>
            </Button>
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Uploaded file */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-success/5 border border-success/20">
            <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
              <FileText className="w-6 h-6 text-success" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-foreground">{primaryResume.title}</p>
              <p className="text-sm text-muted-foreground">
                {primaryResume.original_filename || "Resume"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-success" />
              <button 
                onClick={() => deleteResume(primaryResume.id)}
                className="p-1 hover:bg-destructive/10 rounded"
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </button>
            </div>
          </div>

          {/* ATS Score */}
          {primaryResume.ats_score !== null && (
            <div className="p-4 rounded-xl bg-secondary/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">ATS Score</span>
                <span className={cn(
                  "text-lg font-bold",
                  primaryResume.ats_score >= 80 ? "text-success" : 
                  primaryResume.ats_score >= 60 ? "text-warning" : "text-destructive"
                )}>
                  {primaryResume.ats_score}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                <div 
                  className={cn(
                    "h-full rounded-full transition-all",
                    primaryResume.ats_score >= 80 ? "bg-gradient-to-r from-success to-accent" : 
                    primaryResume.ats_score >= 60 ? "bg-warning" : "bg-destructive"
                  )}
                  style={{ width: `${primaryResume.ats_score}%` }}
                />
              </div>
            </div>
          )}

          {/* Skills */}
          {primaryResume.skills && primaryResume.skills.length > 0 && (
            <div className="p-4 rounded-xl bg-secondary/50">
              <p className="text-sm font-medium text-foreground mb-2">Detected Skills</p>
              <div className="flex flex-wrap gap-2">
                {primaryResume.skills.slice(0, 6).map((skill) => (
                  <span key={skill} className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full">
                    {skill}
                  </span>
                ))}
                {primaryResume.skills.length > 6 && (
                  <span className="px-2 py-1 text-muted-foreground text-xs">
                    +{primaryResume.skills.length - 6} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Suggestions */}
          {!primaryResume.ats_score && (
            <div className="p-4 rounded-xl border border-warning/20 bg-warning/5">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground mb-1">
                    Analyze your resume with AI
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Get ATS score, skill detection, and optimization suggestions.
                  </p>
                </div>
              </div>
            </div>
          )}

          <Button className="w-full" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : primaryResume.ats_score ? (
              "Re-analyze Resume"
            ) : (
              "Optimize with AI"
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
