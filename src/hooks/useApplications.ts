import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Json } from "@/integrations/supabase/types";

export type ApplicationStatus = 
  | 'pending-apply'
  | 'applying'
  | 'applied'
  | 'in-review'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'error'
  | 'needs-user-action';

export interface Application {
  id: string;
  user_id: string;
  job_id: string;
  resume_id: string | null;
  status: ApplicationStatus;
  cover_letter: string | null;
  applied_at: string;
  response_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // New fields per spec
  platform: string;
  status_source: string;
  status_message: string | null;
  job_title: string | null;
  company_name: string | null;
  job_url: string | null;
  email_thread_id: string | null;
  extra_metadata: Json | null;
  job?: {
    title: string;
    company: string;
    location: string | null;
    url: string | null;
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
          job:jobs(title, company, location, url)
        `)
        .eq("user_id", user.id)
        .order("applied_at", { ascending: false });

      if (error) throw error;
      // Cast status to ApplicationStatus since DB validates it
      setApplications((data || []).map(app => ({
        ...app,
        status: app.status as ApplicationStatus,
      })));
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
          job:jobs(title, company, location, url)
        `)
        .single();

      if (error) throw error;

      const newApp = { ...data, status: data.status as ApplicationStatus };
      setApplications(prev => [newApp, ...prev]);
      toast({ title: "Application submitted!", description: "Good luck!" });
      return newApp;
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

  const updateStatus = async (applicationId: string, status: ApplicationStatus) => {
    try {
      const { error } = await supabase
        .from("applications")
        .update({ 
          status,
          response_at: ["in-review", "interview", "offer", "rejected"].includes(status) 
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
    pendingApply: applications.filter(a => a.status === "pending-apply").length,
    applying: applications.filter(a => a.status === "applying").length,
    applied: applications.filter(a => a.status === "applied").length,
    inReview: applications.filter(a => a.status === "in-review").length,
    interviews: applications.filter(a => a.status === "interview").length,
    offers: applications.filter(a => a.status === "offer").length,
    rejected: applications.filter(a => a.status === "rejected").length,
    errors: applications.filter(a => a.status === "error").length,
    needsAction: applications.filter(a => a.status === "needs-user-action").length,
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
