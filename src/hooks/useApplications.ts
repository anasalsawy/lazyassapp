import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface Application {
  id: string;
  user_id: string;
  job_id: string;
  resume_id: string | null;
  status: string;
  cover_letter: string | null;
  applied_at: string;
  response_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  job?: {
    title: string;
    company: string;
    location: string | null;
  };
}

export const useApplications = () => {
  const { user } = useAuth();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      fetchApplications();
    } else {
      setApplications([]);
      setLoading(false);
    }
  }, [user]);

  const fetchApplications = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("applications")
        .select(`
          *,
          job:jobs(title, company, location)
        `)
        .eq("user_id", user.id)
        .order("applied_at", { ascending: false });

      if (error) throw error;
      setApplications(data || []);
    } catch (error: any) {
      console.error("Error fetching applications:", error);
    } finally {
      setLoading(false);
    }
  };

  const createApplication = async (jobId: string, resumeId?: string, coverLetter?: string) => {
    if (!user) return null;

    try {
      const { data, error } = await supabase
        .from("applications")
        .insert({
          user_id: user.id,
          job_id: jobId,
          resume_id: resumeId,
          cover_letter: coverLetter,
          status: "applied",
        })
        .select(`
          *,
          job:jobs(title, company, location)
        `)
        .single();

      if (error) throw error;

      setApplications(prev => [data, ...prev]);
      toast({ title: "Application submitted!", description: "Good luck!" });
      return data;
    } catch (error: any) {
      console.error("Error creating application:", error);
      toast({ 
        title: "Application failed", 
        description: error.message || "Failed to submit application", 
        variant: "destructive" 
      });
      return null;
    }
  };

  const updateStatus = async (applicationId: string, status: string) => {
    try {
      const { error } = await supabase
        .from("applications")
        .update({ 
          status,
          response_at: ["under_review", "interview", "offer", "rejected"].includes(status) 
            ? new Date().toISOString() 
            : null,
        })
        .eq("id", applicationId);

      if (error) throw error;

      setApplications(prev => prev.map(a => 
        a.id === applicationId ? { ...a, status } : a
      ));
      toast({ title: "Status updated" });
    } catch (error: any) {
      console.error("Error updating status:", error);
      toast({ 
        title: "Error", 
        description: "Failed to update status", 
        variant: "destructive" 
      });
    }
  };

  const deleteApplication = async (applicationId: string) => {
    try {
      const { error } = await supabase
        .from("applications")
        .delete()
        .eq("id", applicationId);

      if (error) throw error;

      setApplications(prev => prev.filter(a => a.id !== applicationId));
      toast({ title: "Application deleted" });
    } catch (error: any) {
      console.error("Error deleting application:", error);
    }
  };

  const stats = {
    total: applications.length,
    applied: applications.filter(a => a.status === "applied").length,
    underReview: applications.filter(a => a.status === "under_review").length,
    interviews: applications.filter(a => a.status === "interview").length,
    offers: applications.filter(a => a.status === "offer").length,
    rejected: applications.filter(a => a.status === "rejected").length,
  };

  return { 
    applications, 
    loading, 
    stats,
    createApplication, 
    updateStatus, 
    deleteApplication,
    refetch: fetchApplications,
  };
};
