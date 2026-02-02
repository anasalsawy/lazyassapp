import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useJobs } from "@/hooks/useJobs";
import { useJobPreferences } from "@/hooks/useJobPreferences";
import { useResumes } from "@/hooks/useResumes";
import { useApplications } from "@/hooks/useApplications";
import { useJobScraper } from "@/hooks/useJobScraper";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, MapPin, DollarSign, Heart, Search, 
  Loader2, ExternalLink, Trash2, Filter, Zap, Globe,
  CheckCircle, Sparkles
} from "lucide-react";
import { useState } from "react";

const Jobs = () => {
  const { jobs, loading, searching, searchJobs, toggleSaved, deleteJob, refetch } = useJobs();
  const { preferences } = useJobPreferences();
  const { primaryResume } = useResumes();
  const { createApplication, applications } = useApplications();
  const { loading: scraping, scrapeJobs, stats: scrapeStats } = useJobScraper();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [applyingTo, setApplyingTo] = useState<string | null>(null);
  const { toast } = useToast();

  // AI-powered search using mock data
  const handleAISearch = () => {
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

  // Real job board scraping using Firecrawl
  const handleRealScrape = async () => {
    await scrapeJobs();
    await refetch(); // Refresh the jobs list
  };

  // Smart apply with cover letter generation
  const handleSmartApply = async (jobId: string, generateCoverLetter: boolean = true) => {
    setApplyingTo(jobId);
    try {
      const { data, error } = await supabase.functions.invoke("submit-application", {
        body: { 
          jobId, 
          generateCoverLetter,
        },
      });

      if (error) throw error;

      if (data.error) {
        toast({
          title: "Application Error",
          description: data.error,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Application Submitted! 🎉",
          description: data.message,
        });
        await refetch();
      }
    } catch (error: any) {
      console.error("Apply error:", error);
      toast({
        title: "Application Failed",
        description: error.message || "Failed to submit application",
        variant: "destructive",
      });
    } finally {
      setApplyingTo(null);
    }
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
            Find and apply to jobs from real job boards with AI assistance
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleRealScrape} 
            disabled={scraping}
            className="bg-gradient-to-r from-primary to-accent hover:opacity-90"
          >
            {scraping ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Scraping Real Jobs...
              </>
            ) : (
              <>
                <Globe className="w-4 h-4 mr-2" />
                Scrape Real Jobs
              </>
            )}
          </Button>
          <Button variant="outline" onClick={handleAISearch} disabled={searching}>
            {searching ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                AI Match
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Scrape Stats */}
      {scrapeStats && (
        <div className="glass-card rounded-2xl p-4 mb-6 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-success" />
            <span className="text-sm text-muted-foreground">
              <strong>{scrapeStats.saved}</strong> jobs saved from <strong>{scrapeStats.scraped}</strong> scraped
            </span>
          </div>
          <Badge variant="secondary" className="bg-success/10 text-success">
            Live Data
          </Badge>
        </div>
      )}

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
      {loading || scraping ? (
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
          <Globe className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No jobs found</h3>
          <p className="text-muted-foreground mb-6">
            {showSavedOnly 
              ? "No saved jobs yet." 
              : "Click 'Scrape Real Jobs' to search LinkedIn, Indeed, and Glassdoor for real job listings."}
          </p>
          {!showSavedOnly && (
            <Button onClick={handleRealScrape} disabled={scraping}>
              <Globe className="w-4 h-4 mr-2" />
              Scrape Real Jobs
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredJobs.map((job) => {
            const isApplied = appliedJobIds.includes(job.id);
            const isApplying = applyingTo === job.id;
            
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
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-foreground">{job.title}</h3>
                        {job.source && job.source !== "ai_generated" && (
                          <Badge variant="outline" className="text-xs bg-primary/5">
                            {job.source}
                          </Badge>
                        )}
                      </div>
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
                      <div className={`px-3 py-1 rounded-full ${
                        job.match_score >= 80 ? "bg-success/10" : 
                        job.match_score >= 60 ? "bg-warning/10" : "bg-muted"
                      }`}>
                        <span className={`text-sm font-bold ${
                          job.match_score >= 80 ? "text-success" : 
                          job.match_score >= 60 ? "text-warning" : "text-muted-foreground"
                        }`}>
                          {job.match_score}% match
                        </span>
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
                    {job.requirements.length > 5 && (
                      <Badge variant="outline" className="text-xs">
                        +{job.requirements.length - 5} more
                      </Badge>
                    )}
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
                  <div className="flex items-center gap-2">
                    {isApplied ? (
                      <Badge variant="secondary" className="bg-success/10 text-success">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Applied
                      </Badge>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSmartApply(job.id, false)}
                          disabled={isApplying}
                        >
                          Quick Apply
                        </Button>
                        <Button
                          onClick={() => handleSmartApply(job.id, true)}
                          disabled={isApplying}
                          className="bg-gradient-to-r from-primary to-accent"
                        >
                          {isApplying ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Applying...
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4 mr-2" />
                              Smart Apply
                            </>
                          )}
                        </Button>
                      </>
                    )}
                  </div>
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
