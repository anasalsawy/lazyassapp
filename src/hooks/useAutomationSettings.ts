import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface AutomationSettings {
  id: string;
  user_id: string;
  auto_apply_enabled: boolean;
  daily_apply_limit: number;
  apply_hours_start: number;
  apply_hours_end: number;
  require_cover_letter: boolean;
  min_match_score: number;
  excluded_companies: string[];
  preferred_job_boards: string[];
  applications_today: number;
  last_auto_apply_at: string | null;
}

export const useAutomationSettings = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      fetchSettings();
    } else {
      setSettings(null);
      setLoading(false);
    }
  }, [user]);

  const fetchSettings = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("automation_settings")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error && error.code !== "PGRST116") throw error;
      
      if (data) {
        setSettings(data as unknown as AutomationSettings);
      } else {
        // Create default settings
        const { data: newSettings, error: createError } = await supabase
          .from("automation_settings")
          .insert({ user_id: user.id })
          .select()
          .single();
        
        if (createError) throw createError;
        setSettings(newSettings as unknown as AutomationSettings);
      }
    } catch (error: any) {
      console.error("Error fetching automation settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async (updates: Partial<AutomationSettings>) => {
    if (!user || !settings) return;

    try {
      const { error } = await supabase
        .from("automation_settings")
        .update(updates)
        .eq("user_id", user.id);

      if (error) throw error;

      setSettings(prev => prev ? { ...prev, ...updates } : null);
      toast({ title: "Settings updated" });
    } catch (error: any) {
      console.error("Error updating automation settings:", error);
      toast({
        title: "Error",
        description: "Failed to update settings",
        variant: "destructive",
      });
    }
  };

  const toggleAutoApply = async () => {
    if (!settings) return;
    await updateSettings({ auto_apply_enabled: !settings.auto_apply_enabled });
  };

  return {
    settings,
    loading,
    updateSettings,
    toggleAutoApply,
    refetch: fetchSettings,
  };
};
