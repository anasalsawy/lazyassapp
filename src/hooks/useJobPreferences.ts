import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface JobPreferences {
  id: string;
  user_id: string;
  job_titles: string[];
  locations: string[];
  remote_preference: string;
  salary_min: number | null;
  salary_max: number | null;
  industries: string[];
  company_sizes: string[];
  excluded_companies: string[];
  auto_apply_enabled: boolean;
  daily_apply_limit: number;
}

export const useJobPreferences = () => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<JobPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      fetchPreferences();
    } else {
      setPreferences(null);
      setLoading(false);
    }
  }, [user]);

  const fetchPreferences = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("job_preferences")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error) throw error;
      setPreferences(data);
    } catch (error: any) {
      console.error("Error fetching preferences:", error);
    } finally {
      setLoading(false);
    }
  };

  const updatePreferences = async (updates: Partial<JobPreferences>) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("job_preferences")
        .update(updates)
        .eq("user_id", user.id);

      if (error) throw error;
      
      setPreferences(prev => prev ? { ...prev, ...updates } : null);
      toast({ title: "Preferences saved", description: "Your job preferences have been updated." });
    } catch (error: any) {
      console.error("Error updating preferences:", error);
      toast({ 
        title: "Error", 
        description: "Failed to save preferences", 
        variant: "destructive" 
      });
    }
  };

  return { preferences, loading, updatePreferences, refetch: fetchPreferences };
};
