import { Button } from "@/components/ui/button";
import { Upload, FileText, CheckCircle2, AlertCircle, Trash2, Loader2, Rocket, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useResumes } from "@/hooks/useResumes";
import { useAutoPipeline } from "@/hooks/useAutoPipeline";
import { Progress } from "@/components/ui/progress";

export const ResumeUpload = () => {
  const [isDragging, setIsDragging] = useState(false);
  const { resumes, primaryResume, uploadResume, deleteResume, loading } = useResumes();
  const { status: pipelineStatus, triggerPipeline, isRunning } = useAutoPipeline();

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
      const uploaded = await uploadResume(file);
      if (uploaded) {
        // Auto-trigger the full pipeline
        triggerFullPipeline(uploaded.id);
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const uploaded = await uploadResume(file);
      if (uploaded) {
        // Auto-trigger the full pipeline
        triggerFullPipeline(uploaded.id);
      }
    }
  };

  const triggerFullPipeline = async (resumeId: string) => {
    // Use placeholder resume text for now - in production, extract from file
    const resumeText = `
      Experienced professional seeking new opportunities.
      Skills: JavaScript, TypeScript, React, Node.js, Python, SQL
      5+ years of software development experience
      Led cross-functional teams and delivered projects on time
      Strong problem-solving and communication skills
    `;
    await triggerPipeline(resumeId, resumeText);
  };

  const handleRerunPipeline = async () => {
    if (primaryResume) {
      const resumeText = primaryResume.parsed_content?.text || `
        Skills: ${primaryResume.skills?.join(", ") || "General skills"}
        Experience: ${primaryResume.experience_years || 3} years
      `;
      await triggerPipeline(primaryResume.id, resumeText);
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

          {/* Pipeline Status */}
          {isRunning && (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium text-foreground">{pipelineStatus.step}</span>
              </div>
              <Progress value={pipelineStatus.progress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Finding jobs and auto-applying... This may take a few minutes.
              </p>
            </div>
          )}

          {/* Pipeline Result */}
          {!isRunning && pipelineStatus.result && (
            <div className="p-4 rounded-xl border border-success/20 bg-success/5 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-success" />
                <span className="text-sm font-medium text-foreground">Auto-Apply Complete!</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">ATS Score: <span className="text-foreground font-medium">{pipelineStatus.result.atsScore}%</span></div>
                <div className="text-muted-foreground">Jobs Found: <span className="text-foreground font-medium">{pipelineStatus.result.jobsFound}</span></div>
                <div className="text-muted-foreground">Applications: <span className="text-foreground font-medium">{pipelineStatus.result.applications}</span></div>
              </div>
            </div>
          )}

          {/* Auto-Apply Button */}
          <Button 
            className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90" 
            onClick={handleRerunPipeline} 
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Pipeline Running...
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4 mr-2" />
                🚀 Run Auto-Apply Pipeline
              </>
            )}
          </Button>
          
          <p className="text-xs text-center text-muted-foreground">
            Finds matching jobs and applies automatically
          </p>
        </div>
      )}
    </div>
  );
};
