import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useJobs } from "@/hooks/useJobs";
import { useJobPreferences } from "@/hooks/useJobPreferences";
import { useResumes } from "@/hooks/useResumes";
import { useApplications } from "@/hooks/useApplications";
import { 
  Building2, MapPin, DollarSign, Heart, Search, 
  Loader2, ExternalLink, Trash2, Filter 
} from "lucide-react";
import { useState } from "react";

const Jobs = () => {
  const { jobs, loading, searching, searchJobs, toggleSaved, deleteJob } = useJobs();
  const { preferences } = useJobPreferences();
  const { primaryResume } = useResumes();
  const { createApplication, applications } = useApplications();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSavedOnly, setShowSavedOnly] = useState(false);

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

  const handleApply = async (jobId: string) => {
    await createApplication(jobId, primaryResume?.id);
  };

  const appliedJobIds = applications.map(a => a.job_id);

  const filteredJobs = jobs.filter(job => {
    if (showSavedOnly && !job.is_saved) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        job.title.toLowerCase().includes(query) ||
        job.company.toLowerCase().includes(query) ||
        job.location?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Job Search</h1>
          <p className="text-muted-foreground mt-1">
            Find and apply to jobs that match your profile
          </p>
        </div>
        <Button onClick={handleSearch} disabled={searching}>
          {searching ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Searching...
            </>
          ) : (
            <>
              <Search className="w-4 h-4 mr-2" />
              Find New Jobs
            </>
          )}
        </Button>
      </div>

      {/* Filters */}
      <div className="glass-card rounded-2xl p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search jobs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant={showSavedOnly ? "default" : "outline"}
          onClick={() => setShowSavedOnly(!showSavedOnly)}
        >
          <Heart className={`w-4 h-4 mr-2 ${showSavedOnly ? "fill-current" : ""}`} />
          Saved ({jobs.filter(j => j.is_saved).length})
        </Button>
        <Button variant="outline">
          <Filter className="w-4 h-4 mr-2" />
          Filters
        </Button>
      </div>

      {/* Jobs List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card rounded-2xl p-6 animate-pulse">
              <div className="h-6 bg-secondary rounded w-1/3 mb-4" />
              <div className="h-4 bg-secondary rounded w-1/2 mb-2" />
              <div className="h-4 bg-secondary rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <p className="text-muted-foreground mb-4">
            {showSavedOnly ? "No saved jobs yet." : "No jobs found. Try searching for new opportunities!"}
          </p>
          {!showSavedOnly && (
            <Button onClick={handleSearch} disabled={searching}>
              Search for Jobs
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredJobs.map((job) => {
            const isApplied = appliedJobIds.includes(job.id);
            return (
              <div
                key={job.id}
                className="glass-card rounded-2xl p-6 hover:shadow-lg transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                      <Building2 className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{job.title}</h3>
                      <p className="text-muted-foreground">{job.company}</p>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
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
                        {job.job_type && (
                          <Badge variant="secondary">{job.job_type}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.match_score && (
                      <div className="px-3 py-1 rounded-full bg-success/10">
                        <span className="text-sm font-bold text-success">{job.match_score}% match</span>
                      </div>
                    )}
                    <button
                      onClick={() => toggleSaved(job.id)}
                      className="p-2 hover:bg-secondary rounded-lg"
                    >
                      <Heart 
                        className={`w-5 h-5 ${job.is_saved ? "fill-destructive text-destructive" : "text-muted-foreground"}`} 
                      />
                    </button>
                  </div>
                </div>

                {job.description && (
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {job.description}
                  </p>
                )}

                {job.requirements && job.requirements.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {job.requirements.slice(0, 5).map((req) => (
                      <Badge key={req} variant="outline" className="text-xs">
                        {req}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => deleteJob(job.id)}
                      className="p-2 hover:bg-destructive/10 rounded-lg text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {job.url && (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 hover:bg-secondary rounded-lg text-muted-foreground"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                  <Button
                    onClick={() => handleApply(job.id)}
                    disabled={isApplied}
                    variant={isApplied ? "outline" : "default"}
                  >
                    {isApplied ? "Applied" : "Apply Now"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Jobs;
