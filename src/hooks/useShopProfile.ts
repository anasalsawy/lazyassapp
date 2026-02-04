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

export interface OrderEmail {
  id: string;
  user_id: string;
  order_id: string | null;
  gmail_message_id: string;
  thread_id: string | null;
  from_email: string;
  from_name: string | null;
  to_email: string | null;
  subject: string;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string;
  is_read: boolean;
  email_type: string;
  extracted_data: Record<string, unknown>;
  created_at: string;
}

export function useShopProfile() {
  const { user, session } = useAuth();
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [tracking, setTracking] = useState<OrderTracking[]>([]);
  const [orderEmails, setOrderEmails] = useState<OrderEmail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingEmails, setIsSyncingEmails] = useState(false);
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

      if (error) {
        // Check for insufficient credits error from the response
        const errorMessage = error.message || "";
        if (errorMessage.includes("credits") || errorMessage.includes("INSUFFICIENT_CREDITS")) {
          toast.error("Browser Use API credits insufficient", {
            description: "Please add credits to your Browser Use account to continue.",
            duration: 10000,
          });
          return { success: false, code: "INSUFFICIENT_CREDITS" };
        }
        throw error;
      }
      
      // Also check for error code in successful response (edge function returned 402)
      if (data?.code === "INSUFFICIENT_CREDITS") {
        toast.error("Browser Use API credits insufficient", {
          description: "Please add credits to your Browser Use account to continue.",
          duration: 10000,
        });
        return data;
      }
      
      return data;
    } catch (error: unknown) {
      console.error("[ShopProfile]", error);
      const message = error instanceof Error ? error.message : "Agent error";
      
      // Final check for credits error
      if (message.includes("credits") || message.includes("balance")) {
        toast.error("Browser Use API credits insufficient", {
          description: "Please add credits to your Browser Use account.",
          duration: 10000,
        });
        return { success: false, code: "INSUFFICIENT_CREDITS" };
      }
      
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
    
    // Also fetch order emails from the database
    const { data: emails } = await supabase
      .from("order_emails")
      .select("*")
      .eq("user_id", user.id)
      .order("received_at", { ascending: false })
      .limit(50);
    
    if (emails) {
      setOrderEmails(emails as OrderEmail[]);
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

  // Cancel pending login session
  const cancelLogin = useCallback(async () => {
    toast.info("Cancelling login session...");
    const data = await callAgent("cancel_login");
    if (data?.success) {
      toast.success("Session cancelled");
      setLoginSession(null);
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

  // Restart a login session (cleanup + fresh start)
  const restartSession = useCallback(async (site: string) => {
    toast.info(`Restarting ${site} session...`);
    const data = await callAgent("restart_session", { site });
    if (data?.success) {
      setLoginSession({
        sessionId: data.sessionId,
        taskId: data.taskId,
        liveViewUrl: data.liveViewUrl,
        site: data.site,
      });
      toast.success("Session restarted! Log in to your account.");
    }
    return data;
  }, [callAgent]);

  // Manual session cleanup
  const cleanupSessions = useCallback(async () => {
    toast.info("Cleaning up stale sessions...");
    const data = await callAgent("cleanup_sessions");
    if (data?.success) {
      toast.success(data.message || "Sessions cleaned up");
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

  // Test proxy connection - runs 3-step verification: baseline → proxy → baseline
  const testProxy = useCallback(async () => {
    toast.info("Testing proxy... Running 3-step IP verification (may take 2-3 minutes)", {
      duration: 10000,
    });
    const data = await callAgent("test_proxy");
    if (data?.success && data.tested) {
      const baseline1Ip = data.baseline1Ip || "unknown";
      const proxyIp = data.proxyIp || "unknown";
      const baseline2Ip = data.baseline2Ip || "unknown";
      
      if (data.allTestsPassed) {
        toast.success(`✅ Proxy verified!`, {
          duration: 20000,
          description: `Step 1 (no proxy): ${baseline1Ip}\nStep 2 (with proxy): ${proxyIp}\nStep 3 (no proxy): ${baseline2Ip}\n\nProxy changes IP and switching works correctly.`,
        });
      } else if (data.proxyWorking && !data.baselineConsistent) {
        toast.warning(`⚠️ Proxy works but baseline inconsistent`, {
          duration: 20000,
          description: `Step 1: ${baseline1Ip}\nStep 2 (proxy): ${proxyIp}\nStep 3: ${baseline2Ip}\n\nProxy IP differs but baseline IPs don't match. Network may be unstable.`,
        });
      } else {
        toast.error(`❌ Proxy NOT working`, {
          duration: 20000,
          description: `Step 1: ${baseline1Ip}\nStep 2 (proxy): ${proxyIp}\nStep 3: ${baseline2Ip}\n\nProxy IP matches baseline. Check credentials.`,
        });
      }
    } else if (data?.error) {
      toast.error(data.error);
    }
    return data;
  }, [callAgent]);

  // Sync order-related emails from Gmail
  const syncOrderEmails = useCallback(async () => {
    if (!user || isSyncingEmails) return;
    
    setIsSyncingEmails(true);
    toast.info("Searching Gmail for order emails... This may take 2-3 minutes.");
    
    const data = await callAgent("sync_order_emails");
    
    if (data?.success) {
      toast.success(`Found ${data.inserted} new order emails!`, {
        description: data.totalFound > 0 ? `Total found: ${data.totalFound}, Skipped duplicates: ${data.skipped}` : undefined,
      });
      // Refetch to get new emails
      await fetchStatus();
    } else if (data?.error) {
      toast.error(data.error);
    }
    
    setIsSyncingEmails(false);
    return data;
  }, [callAgent, user, isSyncingEmails, fetchStatus]);

  return {
    profile,
    tracking,
    orderEmails,
    isLoading,
    isSyncing,
    isSyncingEmails,
    loginSession,
    createProfile,
    startLogin,
    confirmLogin,
    syncOrders,
    syncOrderEmails,
    setProxy,
    clearProxy,
    testProxy,
    refetch: fetchStatus,
  };
}
