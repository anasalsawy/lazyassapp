import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

interface ShopProfile {
  hasProfile: boolean;
  sitesLoggedIn: string[];
  lastLoginAt: string | null;
  status: string;
  proxyServer: string | null;
  proxyUsername: string | null;
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [loginSession, setLoginSession] = useState<{
    sessionId: string;
    taskId: string;
    liveViewUrl: string;
    site: string;
  } | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

  // Sync all pending orders with Browser Use API
  const syncOrders = useCallback(async () => {
    if (!user || isSyncing) return;
    
    setIsSyncing(true);
    const data = await callAgent("sync_all_orders");
    if (data?.success && data.synced > 0) {
      console.log(`[ShopProfile] Synced ${data.synced} orders`);
      // Refetch status to get updated orders
      await fetchStatus();
    }
    setIsSyncing(false);
    return data;
  }, [callAgent, user, isSyncing, fetchStatus]);

  // Auto-sync every 30 seconds when there are pending orders
  useEffect(() => {
    // Clear existing interval
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    // Start auto-sync if user is logged in
    if (user && session?.access_token) {
      syncIntervalRef.current = setInterval(() => {
        syncOrders();
      }, 30000); // Every 30 seconds
    }

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [user, session?.access_token, syncOrders]);

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

  // Set custom proxy
  const setProxy = useCallback(async (proxyServer: string, proxyUsername?: string, proxyPassword?: string) => {
    toast.info("Configuring proxy...");
    const data = await callAgent("set_proxy", { 
      proxyServer: proxyServer || null, 
      proxyUsername: proxyUsername || null,
      proxyPassword: proxyPassword || null 
    });
    if (data?.success) {
      toast.success(proxyServer ? "Proxy configured!" : "Proxy cleared");
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

  // Clear proxy
  const clearProxy = useCallback(async () => {
    return setProxy("", "", "");
  }, [setProxy]);

  // Test proxy connection - runs two tests: baseline (no proxy) and with proxy
  const testProxy = useCallback(async () => {
    toast.info("Testing proxy... Running 2 parallel IP checks (may take 60-90 seconds)");
    const data = await callAgent("test_proxy");
    if (data?.success && data.tested) {
      const baselineIp = data.baselineIp || "unknown";
      const proxyIp = data.proxyIp || "unknown";
      
      if (data.proxyWorking) {
        toast.success(`✅ Proxy is working!`, {
          duration: 15000,
          description: `Without proxy: ${baselineIp}\nWith proxy: ${proxyIp}`,
        });
      } else {
        toast.error(`❌ Proxy NOT working`, {
          duration: 15000,
          description: `Both IPs same: ${baselineIp} = ${proxyIp}\nCheck your proxy credentials.`,
        });
      }
    } else if (data?.error) {
      toast.error(data.error);
    }
    return data;
  }, [callAgent]);

  return {
    profile,
    tracking,
    isLoading,
    isSyncing,
    loginSession,
    createProfile,
    startLogin,
    confirmLogin,
    syncOrders,
    setProxy,
    clearProxy,
    testProxy,
    refetch: fetchStatus,
  };
}
