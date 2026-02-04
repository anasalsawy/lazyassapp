import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface Job {
  id: string;
  user_id: string;
  external_id: string | null;
  source: string;
  title: string;
  company: string;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  description: string | null;
  requirements: string[] | null;
  job_type: string | null;
  posted_at: string | null;
  expires_at: string | null;
  url: string | null;
  match_score: number | null;
  is_saved: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResumeForMatching {
  skills?: string[] | null;
  experienceYears?: number | null;
  parsedContent?: any;
  fullText?: string;
  atsScore?: number | null;
}

export interface JobPreferencesForMatching {
  jobTitles?: string[];
  locations?: string[];
  remotePreference?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  industries?: string[];
}

export const useJobs = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      fetchJobs();
    } else {
      setJobs([]);
      setLoading(false);
    }
  }, [user]);

  const fetchJobs = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("user_id", user.id)
        .order("match_score", { ascending: false, nullsFirst: false });

      if (error) throw error;
      setJobs(data || []);
    } catch (error: any) {
      console.error("Error fetching jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  const searchJobs = async (
    preferences: JobPreferencesForMatching, 
    resume?: ResumeForMatching
  ) => {
    if (!user) return;

    setSearching(true);
    try {
      console.log("Starting job search with:", {
        preferences,
        resumeSkills: resume?.skills?.length || 0,
        hasFullText: !!resume?.fullText,
        hasParsedContent: !!resume?.parsedContent
      });

      const { data, error } = await supabase.functions.invoke("match-jobs", {
        body: { 
          preferences,
          resume: {
            skills: resume?.skills || [],
            experienceYears: resume?.experienceYears || 0,
            parsedContent: resume?.parsedContent || null,
            fullText: resume?.fullText || "",
            atsScore: resume?.atsScore || null
          }
        },
      });

      if (error) throw error;

      if (data.success && data.jobs) {
        console.log(`Received ${data.jobs.length} job matches`, data.matchedWith);
        
        // Save matched jobs to database
        const jobsToInsert = data.jobs.map((job: any) => ({
          user_id: user.id,
          external_id: job.externalId,
          source: job.source,
          title: job.title,
          company: job.company,
          location: job.location,
          salary_min: job.salaryMin,
          salary_max: job.salaryMax,
          description: job.description + (job.matchReason ? `\n\nMatch Reason: ${job.matchReason}` : ""),
          requirements: job.requirements,
          job_type: job.jobType,
          posted_at: job.postedAt,
          url: job.url,
          match_score: job.matchScore,
        }));

        const { error: insertError } = await supabase
          .from("jobs")
          .upsert(jobsToInsert, { onConflict: "id" });

        if (insertError) throw insertError;

        await fetchJobs();
        
        const topScore = data.jobs[0]?.matchScore || 0;
        toast({ 
          title: "Jobs matched!", 
          description: `Found ${data.jobs.length} matches. Best match: ${topScore}%` 
        });
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Error searching jobs:", error);
      toast({ 
        title: "Search failed", 
        description: error.message || "Failed to search for jobs", 
        variant: "destructive" 
      });
    } finally {
      setSearching(false);
    }
  };

  const toggleSaved = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    try {
      const { error } = await supabase
        .from("jobs")
        .update({ is_saved: !job.is_saved })
        .eq("id", jobId);

      if (error) throw error;

      setJobs(prev => prev.map(j => 
        j.id === jobId ? { ...j, is_saved: !j.is_saved } : j
      ));
    } catch (error: any) {
      console.error("Error toggling saved:", error);
    }
  };

  const deleteJob = async (jobId: string) => {
    try {
      const { error } = await supabase
        .from("jobs")
        .delete()
        .eq("id", jobId);

      if (error) throw error;
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch (error: any) {
      console.error("Error deleting job:", error);
    }
  };

  const clearAllJobs = async () => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from("jobs")
        .delete()
        .eq("user_id", user.id);

      if (error) throw error;
      setJobs([]);
      toast({ title: "Jobs cleared", description: "All job matches have been removed." });
    } catch (error: any) {
      console.error("Error clearing jobs:", error);
      toast({ 
        title: "Error", 
        description: "Failed to clear jobs", 
        variant: "destructive" 
      });
    }
  };

  return { 
    jobs, 
    loading, 
    searching,
    searchJobs, 
    toggleSaved, 
    deleteJob,
    clearAllJobs,
    refetch: fetchJobs,
    savedJobs: jobs.filter(j => j.is_saved),
    topMatches: jobs.slice(0, 10),
  };
};
