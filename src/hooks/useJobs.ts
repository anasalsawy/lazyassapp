import { useState, useEffect, useCallback } from "react";
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
  const [searchProgress, setSearchProgress] = useState({ current: 0, total: 0 });
  const [deepSearchStatus, setDeepSearchStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [deepSearchResult, setDeepSearchResult] = useState<any>(null);
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

  const saveJobsBatch = useCallback(async (userId: string, jobsToSave: any[]) => {
    const jobsToInsert = jobsToSave.map((job: any) => ({
      user_id: userId,
      external_id: job.externalId || `gen-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      source: job.source || "ai_matched",
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

    // Use upsert with external_id to avoid duplicates
    const { error: insertError } = await supabase
      .from("jobs")
      .upsert(jobsToInsert, { 
        onConflict: "user_id,external_id",
        ignoreDuplicates: true 
      });

    if (insertError) {
      console.error("Error saving jobs batch:", insertError);
      // Don't throw - continue with other batches
    }

    return jobsToInsert.length;
  }, []);

  const searchJobs = async (
    preferences: JobPreferencesForMatching, 
    resume?: ResumeForMatching
  ) => {
    if (!user) return;

    setSearching(true);
    
    let totalJobsFound = 0;
    let currentBatch = 1;
    const maxBatches = 10; // Up to 250 jobs (25 per batch)
    setSearchProgress({ current: 0, total: maxBatches });
    
    try {
      console.log("Starting job search with full resume data:", {
        preferences,
        resumeSkills: resume?.skills?.length || 0,
        hasFullText: !!resume?.fullText,
        fullTextLength: resume?.fullText?.length || 0,
        hasParsedContent: !!resume?.parsedContent
      });

      // Clear existing jobs first for fresh search
      await supabase
        .from("jobs")
        .delete()
        .eq("user_id", user.id);

      // Fetch jobs in batches
      while (currentBatch <= maxBatches) {
        setSearchProgress({ current: currentBatch, total: maxBatches });
        
        console.log(`Fetching batch ${currentBatch}/${maxBatches}...`);
        
        const { data, error } = await supabase.functions.invoke("match-jobs", {
          body: { 
            preferences,
            resume: {
              skills: resume?.skills || [],
              experienceYears: resume?.experienceYears || 0,
              parsedContent: resume?.parsedContent || null,
              fullText: resume?.fullText || "",
              atsScore: resume?.atsScore || null
            },
            batchNumber: currentBatch
          },
        });

        if (error) {
          console.error(`Batch ${currentBatch} error:`, error);
          // Retry same batch once after short delay
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        if (data.success && data.jobs && data.jobs.length > 0) {
          console.log(`Batch ${currentBatch}: Received ${data.jobs.length} jobs`, data.matchedWith);
          
          // Save this batch to database
          const saved = await saveJobsBatch(user.id, data.jobs);
          totalJobsFound += saved;
          
          // Check if there are more results - be more lenient
          if (!data.hasMore && data.jobs.length < 10) {
            console.log("No more batches available");
            break;
          }
          
          currentBatch++;
          
          // Add delay between batches to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 300));
        } else if (data.error) {
          throw new Error(data.error);
        } else {
          // No jobs in response, stop fetching
          break;
        }
      }

      // Refresh the jobs list
      await fetchJobs();
      
      const topScore = jobs[0]?.match_score || 0;
      toast({ 
        title: "Job search complete!", 
        description: `Found ${totalJobsFound} matches based on your resume.` 
      });
      
    } catch (error: any) {
      console.error("Error searching jobs:", error);
      toast({ 
        title: "Search failed", 
        description: error.message || "Failed to search for jobs", 
        variant: "destructive" 
      });
    } finally {
      setSearching(false);
      setSearchProgress({ current: 0, total: 0 });
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
    searchProgress,
    searchJobs, 
    toggleSaved, 
    deleteJob,
    clearAllJobs,
    refetch: fetchJobs,
    savedJobs: jobs.filter(j => j.is_saved),
    topMatches: jobs.slice(0, 10),
  };
};
