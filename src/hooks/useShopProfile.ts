import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

interface ShopProfile {
  hasProfile: boolean;
  sitesLoggedIn: string[];
  lastLoginAt: string | null;
  status: string;
}

interface OrderTracking {
  id: string;
  order_id: string;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  status: string;
  last_update: string | null;
  estimated_delivery: string | null;
  created_at: string;
}

export function useShopProfile() {
  const { user, session } = useAuth();
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [tracking, setTracking] = useState<OrderTracking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loginSession, setLoginSession] = useState<{
    sessionId: string;
    taskId: string;
    liveViewUrl: string;
    site: string;
  } | null>(null);

  const callAgent = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    if (!session?.access_token) {
      toast.error("Please sign in");
      return null;
    }

    try {
      const { data, error } = await supabase.functions.invoke("auto-shop", {
        body: { action, ...body },
      });

      if (error) throw error;
      return data;
    } catch (error: unknown) {
      console.error("[ShopProfile]", error);
      const message = error instanceof Error ? error.message : "Agent error";
      toast.error(message);
      return null;
    }
  }, [session?.access_token]);

  // Fetch status on mount
  const fetchStatus = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    const data = await callAgent("get_status");
    if (data) {
      setProfile(data.profile);
      setTracking(data.tracking || []);
    }
    setIsLoading(false);
  }, [callAgent, user]);

  useEffect(() => {
    if (user) {
      fetchStatus();
    }
  }, [user, fetchStatus]);

  // Create browser profile
  const createProfile = useCallback(async () => {
    toast.info("Creating browser profile...");
    const data = await callAgent("create_profile");
    if (data?.success) {
      toast.success("Profile created!");
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

  // Start login session for email
  const startLogin = useCallback(async (site: string) => {
    toast.info(`Opening ${site} for login...`);
    const data = await callAgent("start_login", { site });
    if (data?.success) {
      setLoginSession({
        sessionId: data.sessionId,
        taskId: data.taskId,
        liveViewUrl: data.liveViewUrl,
        site: data.site,
      });
      toast.success("Browser opened! Log in to your account.");
    }
    return data;
  }, [callAgent]);

  // Confirm login completed
  const confirmLogin = useCallback(async (site: string) => {
    const data = await callAgent("confirm_login", { site });
    if (data?.success) {
      toast.success(`${site} connected!`);
      setLoginSession(null);
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

  return {
    profile,
    tracking,
    isLoading,
    loginSession,
    createProfile,
    startLogin,
    confirmLogin,
    refetch: fetchStatus,
  };
}
