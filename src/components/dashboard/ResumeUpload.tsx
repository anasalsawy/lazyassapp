import { Button } from "@/components/ui/button";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export const ResumeUpload = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "application/pdf" || file.type.includes("word"))) {
      setUploadedFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Your Resume</h2>
        {uploadedFile && (
          <Button variant="outline" size="sm">
            View Resume
          </Button>
        )}
      </div>

      {!uploadedFile ? (
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
              <p className="font-medium text-foreground">{uploadedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {(uploadedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-success" />
          </div>

          {/* ATS Score */}
          <div className="p-4 rounded-xl bg-secondary/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">ATS Score</span>
              <span className="text-lg font-bold text-success">87%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
              <div className="h-full w-[87%] rounded-full bg-gradient-to-r from-success to-accent" />
            </div>
          </div>

          {/* Suggestions */}
          <div className="p-4 rounded-xl border border-warning/20 bg-warning/5">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground mb-1">
                  2 suggestions to improve
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Add more quantifiable achievements</li>
                  <li>• Include relevant keywords for target roles</li>
                </ul>
              </div>
            </div>
          </div>

          <Button className="w-full">
            Optimize with AI
          </Button>
        </div>
      )}
    </div>
  );
};
