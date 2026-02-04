import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, DollarSign, Sparkles, Heart, Loader2, Trash2 } from "lucide-react";
import { useJobs } from "@/hooks/useJobs";
import { useJobPreferences } from "@/hooks/useJobPreferences";
import { useResumes } from "@/hooks/useResumes";
import { useApplications } from "@/hooks/useApplications";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export const JobMatches = () => {
  const { jobs, loading, searching, searchProgress, searchJobs, toggleSaved, clearAllJobs } = useJobs();
  const { preferences } = useJobPreferences();
  const { primaryResume } = useResumes();
  const { createApplication } = useApplications();
  const { toast } = useToast();

  const topJobs = jobs.slice(0, 5); // Show more top jobs

  const handleSearch = async () => {
    if (!primaryResume) {
      toast({
        title: "No resume found",
        description: "Please upload a resume first to match jobs with your skills.",
        variant: "destructive"
      });
      return;
    }

    // Build complete resume data for matching - include FULL resume text
    const parsedContent = primaryResume.parsed_content || {};
    
    // Extract full text from ALL possible sources - prioritize longest
    const possibleTexts = [
      parsedContent?.rawText,
      parsedContent?.fullText,
      parsedContent?.text,
      parsedContent?.content,
      parsedContent?.resume_text,
      typeof parsedContent === 'string' ? parsedContent : null,
    ].filter(Boolean);
    const fullText = possibleTexts.sort((a, b) => (b?.length || 0) - (a?.length || 0))[0] || "";
    
    const resumeData = {
      skills: primaryResume.skills || [],
      experienceYears: primaryResume.experience_years || 0,
      parsedContent: parsedContent,
      atsScore: primaryResume.ats_score || null,
      fullText: fullText,
    };

    // Build preferences with fallbacks
    const jobPrefs = {
      jobTitles: preferences?.job_titles || [],
      locations: preferences?.locations || [],
      remotePreference: preferences?.remote_preference || "any",
      salaryMin: preferences?.salary_min || null,
      salaryMax: preferences?.salary_max || null,
      industries: preferences?.industries || [],
    };

    console.log("Searching with FULL resume data:", {
      skillsCount: resumeData.skills?.length,
      experience: resumeData.experienceYears,
      hasContent: !!resumeData.parsedContent,
      fullTextLength: resumeData.fullText?.length || 0,
      atsScore: resumeData.atsScore
    });

    await searchJobs(jobPrefs, resumeData);
  };

  const handleQuickApply = async (jobId: string) => {
    await createApplication(jobId, primaryResume?.id);
  };

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-secondary rounded w-1/3" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-secondary rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">Top Job Matches</h2>
          <Sparkles className="w-4 h-4 text-accent" />
        </div>
        <div className="flex items-center gap-2">
          {jobs.length > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearAllJobs}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleSearch}
            disabled={searching}
          >
            {searching ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {searchProgress.total > 0 
                  ? `Batch ${searchProgress.current}/${searchProgress.total}...`
                  : "Matching..."}
              </>
            ) : (
              "Find Jobs"
            )}
          </Button>
          <Link to="/dashboard/jobs" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
      </div>

      {!primaryResume && (
        <div className="mb-4 p-3 bg-warning/10 border border-warning/20 rounded-lg">
          <p className="text-sm text-warning">
            Upload a resume to enable intelligent job matching based on your skills and experience.
          </p>
        </div>
      )}

      {topJobs.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground mb-4">No job matches yet.</p>
          <Button onClick={handleSearch} disabled={searching || !primaryResume}>
            {searching ? "Matching..." : "Search for Jobs"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {topJobs.map((job) => (
            <div
              key={job.id}
              className="p-4 rounded-xl border border-border hover:border-primary/50 hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{job.title}</h3>
                    <p className="text-sm text-muted-foreground">{job.company}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleSaved(job.id)}
                    className="p-1 hover:bg-secondary rounded"
                  >
                    <Heart 
                      className={`w-4 h-4 ${job.is_saved ? "fill-destructive text-destructive" : "text-muted-foreground"}`} 
                    />
                  </button>
                  {job.match_score && (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${
                      job.match_score >= 90 ? "bg-success/20" :
                      job.match_score >= 80 ? "bg-success/10" :
                      job.match_score >= 70 ? "bg-warning/10" :
                      "bg-muted"
                    }`}>
                      <span className={`text-xs font-bold ${
                        job.match_score >= 90 ? "text-success" :
                        job.match_score >= 80 ? "text-success" :
                        job.match_score >= 70 ? "text-warning" :
                        "text-muted-foreground"
                      }`}>{job.match_score}%</span>
                      <span className={`text-xs ${
                        job.match_score >= 80 ? "text-success" :
                        job.match_score >= 70 ? "text-warning" :
                        "text-muted-foreground"
                      }`}>match</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 mb-3 text-sm text-muted-foreground">
                {job.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {job.location}
                  </span>
                )}
                {(job.salary_min || job.salary_max) && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-4 h-4" />
                    {job.salary_min && job.salary_max 
                      ? `$${(job.salary_min/1000).toFixed(0)}k - $${(job.salary_max/1000).toFixed(0)}k`
                      : job.salary_min 
                        ? `$${(job.salary_min/1000).toFixed(0)}k+`
                        : `Up to $${(job.salary_max!/1000).toFixed(0)}k`}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  {job.requirements?.slice(0, 3).map((req) => (
                    <Badge key={req} variant="secondary" className="text-xs">
                      {req}
                    </Badge>
                  ))}
                </div>
                <Button size="sm" onClick={() => handleQuickApply(job.id)}>
                  Quick Apply
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
