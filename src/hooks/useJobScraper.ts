import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useJobPreferences } from "@/hooks/useJobPreferences";

interface ScrapedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  salary_min: number | null;
  salary_max: number | null;
  description: string;
  requirements: string[];
  job_type: string;
  match_score: number;
  matchReasons?: string[];
  url: string;
  source: string;
}

interface ScrapeStats {
  scraped: number;
  extracted: number;
  saved: number;
}

export const useJobScraper = () => {
  const { session } = useAuth();
  const { preferences } = useJobPreferences();
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<ScrapedJob[]>([]);
  const [stats, setStats] = useState<ScrapeStats | null>(null);
  const { toast } = useToast();

  const scrapeJobs = async (customOptions?: {
    jobTitles?: string[];
    locations?: string[];
    jobBoards?: string[];
    remotePreference?: string;
    salaryMin?: number;
    salaryMax?: number;
    industries?: string[];
  }) => {
    if (!session?.access_token) {
      toast({ title: "Please sign in", variant: "destructive" });
      return null;
    }

    setLoading(true);
    setJobs([]);
    setStats(null);

    try {
      const options = {
        jobTitles: customOptions?.jobTitles || preferences?.job_titles || [],
        locations: customOptions?.locations || preferences?.locations || [],
        jobBoards: customOptions?.jobBoards || ["linkedin", "indeed", "glassdoor"],
        remotePreference: customOptions?.remotePreference || preferences?.remote_preference || "any",
        salaryMin: customOptions?.salaryMin || preferences?.salary_min,
        salaryMax: customOptions?.salaryMax || preferences?.salary_max,
        industries: customOptions?.industries || preferences?.industries || [],
      };

      toast({ 
        title: "Scraping jobs...", 
        description: "This may take a minute. We're searching multiple job boards." 
      });

      const { data, error } = await supabase.functions.invoke("scrape-jobs", {
        body: options,
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setJobs(data.jobs || []);
      setStats(data.stats || null);

      toast({
        title: "Jobs scraped!",
        description: `Found ${data.jobs?.length || 0} matching jobs from real job boards.`,
      });

      return data;
    } catch (error: any) {
      console.error("Error scraping jobs:", error);
      toast({
        title: "Scraping failed",
        description: error.message || "Failed to scrape jobs. Please try again.",
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    jobs,
    stats,
    scrapeJobs,
  };
};
