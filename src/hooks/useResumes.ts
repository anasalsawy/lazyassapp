import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface Resume {
  id: string;
  user_id: string;
  title: string;
  file_path: string | null;
  original_filename: string | null;
  parsed_content: any;
  ats_score: number | null;
  skills: string[] | null;
  experience_years: number | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export const useResumes = () => {
  const { user } = useAuth();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      fetchResumes();
    } else {
      setResumes([]);
      setLoading(false);
    }
  }, [user]);

  const fetchResumes = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("resumes")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setResumes(data || []);
    } catch (error: any) {
      console.error("Error fetching resumes:", error);
    } finally {
      setLoading(false);
    }
  };

  const uploadResume = async (file: File, title?: string) => {
    if (!user) return null;

    try {
      // Upload file to storage
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Create resume record
      const { data, error } = await supabase
        .from("resumes")
        .insert({
          user_id: user.id,
          title: title || file.name.replace(/\.[^/.]+$/, ""),
          file_path: filePath,
          original_filename: file.name,
          is_primary: resumes.length === 0,
        })
        .select()
        .single();

      if (error) throw error;

      setResumes(prev => [data, ...prev]);
      toast({ title: "Resume uploaded", description: "Your resume has been saved." });
      return data;
    } catch (error: any) {
      console.error("Error uploading resume:", error);
      toast({ 
        title: "Upload failed", 
        description: error.message || "Failed to upload resume", 
        variant: "destructive" 
      });
      return null;
    }
  };

  const updateResume = async (id: string, updates: Partial<Resume>) => {
    try {
      const { error } = await supabase
        .from("resumes")
        .update(updates)
        .eq("id", id);

      if (error) throw error;

      setResumes(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    } catch (error: any) {
      console.error("Error updating resume:", error);
      toast({ 
        title: "Error", 
        description: "Failed to update resume", 
        variant: "destructive" 
      });
    }
  };

  const deleteResume = async (id: string) => {
    const resume = resumes.find(r => r.id === id);
    if (!resume) return;

    try {
      // Delete from storage if file exists
      if (resume.file_path) {
        await supabase.storage.from("resumes").remove([resume.file_path]);
      }

      // Delete record
      const { error } = await supabase
        .from("resumes")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setResumes(prev => prev.filter(r => r.id !== id));
      toast({ title: "Resume deleted" });
    } catch (error: any) {
      console.error("Error deleting resume:", error);
      toast({ 
        title: "Error", 
        description: "Failed to delete resume", 
        variant: "destructive" 
      });
    }
  };

  const analyzeResume = async (resumeId: string, resumeText: string, jobDescription?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("analyze-resume", {
        body: { resumeText, jobDescription },
      });

      if (error) throw error;

      if (data.success && data.analysis) {
        await updateResume(resumeId, {
          ats_score: data.analysis.atsScore,
          skills: data.analysis.skills,
          experience_years: data.analysis.experienceYears,
          parsed_content: data.analysis,
        });
        return data.analysis;
      }
      
      throw new Error(data.error || "Analysis failed");
    } catch (error: any) {
      console.error("Error analyzing resume:", error);
      toast({ 
        title: "Analysis failed", 
        description: error.message || "Failed to analyze resume", 
        variant: "destructive" 
      });
      return null;
    }
  };

  return { 
    resumes, 
    loading, 
    uploadResume, 
    updateResume, 
    deleteResume, 
    analyzeResume,
    refetch: fetchResumes,
    primaryResume: resumes.find(r => r.is_primary) || resumes[0],
  };
};
