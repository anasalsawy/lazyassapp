import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, DollarSign, Sparkles, Heart, Loader2 } from "lucide-react";
import { useJobs } from "@/hooks/useJobs";
import { useJobPreferences } from "@/hooks/useJobPreferences";
import { useResumes } from "@/hooks/useResumes";
import { useApplications } from "@/hooks/useApplications";
import { Link } from "react-router-dom";

export const JobMatches = () => {
  const { jobs, loading, searching, searchJobs, toggleSaved } = useJobs();
  const { preferences } = useJobPreferences();
  const { primaryResume } = useResumes();
  const { createApplication } = useApplications();

  const topJobs = jobs.slice(0, 3);

  const handleSearch = () => {
    if (preferences) {
      searchJobs({
        jobTitles: preferences.job_titles,
        locations: preferences.locations,
        remotePreference: preferences.remote_preference,
        salaryMin: preferences.salary_min,
        salaryMax: preferences.salary_max,
        industries: preferences.industries,
      }, primaryResume?.skills || []);
    }
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
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleSearch}
            disabled={searching}
          >
            {searching ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Searching...
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

      {topJobs.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground mb-4">No job matches yet.</p>
          <Button onClick={handleSearch} disabled={searching}>
            {searching ? "Searching..." : "Search for Jobs"}
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
                    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-success/10">
                      <span className="text-xs font-bold text-success">{job.match_score}%</span>
                      <span className="text-xs text-success">match</span>
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
