import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAutoBuyProvider, getOssRunnerUrl } from "@/lib/autoBuyProvider";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

interface ShopProfile {
  hasProfile: boolean;
  sitesLoggedIn: string[];
  lastLoginAt: string | null;
  status: string;
  proxyServer: string | null;
  proxyUsername: string | null;
  useBrowserstack: boolean;
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
  const autoBuyProvider = getAutoBuyProvider();
  const ossRunnerUrl = getOssRunnerUrl();
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

  useEffect(() => {
    console.log(`[ShopProfile] Active provider: ${autoBuyProvider}`, { ossRunnerUrl });
  }, [autoBuyProvider, ossRunnerUrl]);

  const callCloudAgent = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("auto-shop", {
      body: { action, ...body },
    });

    if (error) {
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

    if (data?.code === "INSUFFICIENT_CREDITS") {
      toast.error("Browser Use API credits insufficient", {
        description: "Please add credits to your Browser Use account to continue.",
        duration: 10000,
      });
      return data;
    }

    return data;
  }, []);

  const callAgent = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    if (!session?.access_token) {
      toast.error("Please sign in");
      return null;
    }

    try {
      if (autoBuyProvider === "oss") {
        if (!user?.id) {
          toast.error("Missing user session");
          return null;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 20000);

        try {
          const response = await fetch(`${ossRunnerUrl}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId: user.id,
              action,
              payload: body,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || "OSS runner error");
          }

          const data = await response.json();
          return data;
        } catch (ossError) {
          console.error("[ShopProfile] OSS call failed", ossError);
          toast.error("Local OSS runner is not reachable", {
            description: "Start it with: cd services/oss-runner && node index.js",
          });
          return null;
        } finally {
          clearTimeout(timeoutId);
        }
      }

      return await callCloudAgent(action, body);
    } catch (error: unknown) {
      console.error("[ShopProfile]", error);
      const message = error instanceof Error ? error.message : "Agent error";

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
  }, [session?.access_token, autoBuyProvider, ossRunnerUrl, user?.id, callCloudAgent]);

  const fetchStatus = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    const data = await callAgent("get_status");
    if (data) {
      setProfile(data.profile);
      setTracking(data.tracking || []);
    }

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

  const syncOrders = useCallback(async () => {
    if (!user || isSyncing) return;

    setIsSyncing(true);
    const data = await callAgent("sync_all_orders");
    if (data?.success && data.synced > 0) {
      await fetchStatus();
    }
    setIsSyncing(false);
    return data;
  }, [callAgent, user, isSyncing, fetchStatus]);

  useEffect(() => {
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    if (user && session?.access_token) {
      syncIntervalRef.current = setInterval(() => {
        syncOrders();
      }, 30000);
    }

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [user, session?.access_token, syncOrders]);

  const createProfile = useCallback(async () => {
    toast.info("Creating browser profile...");
    const data = await callAgent("create_profile");
    if (data?.success) {
      toast.success("Profile created!");
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

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

  const confirmLogin = useCallback(async (site: string) => {
    const data = await callAgent("confirm_login", { site });
    if (data?.success) {
      toast.success(`${site} connected!`);
      setLoginSession(null);
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

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

  const setProxy = useCallback(async (proxyServer: string, proxyUsername?: string, proxyPassword?: string) => {
    toast.info("Configuring proxy...");
    const data = await callAgent("set_proxy", {
      proxyServer: proxyServer || null,
      proxyUsername: proxyUsername || null,
      proxyPassword: proxyPassword || null,
    });
    if (data?.success) {
      toast.success(proxyServer ? "Proxy configured!" : "Proxy cleared");
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

  const clearProxy = useCallback(async () => {
    return setProxy("", "", "");
  }, [setProxy]);

  const toggleBrowserstack = useCallback(async (enabled: boolean) => {
    const data = await callAgent("toggle_browserstack", { useBrowserstack: enabled });
    if (data?.success) {
      toast.success(data.message || `BrowserStack ${enabled ? "enabled" : "disabled"}`);
      fetchStatus();
    }
    return data;
  }, [callAgent, fetchStatus]);

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
        toast.success("✅ Proxy verified!", {
          duration: 20000,
          description: `Step 1 (no proxy): ${baseline1Ip}\nStep 2 (with proxy): ${proxyIp}\nStep 3 (no proxy): ${baseline2Ip}\n\nProxy changes IP and switching works correctly.`,
        });
      } else if (data.proxyWorking && !data.baselineConsistent) {
        toast.warning("⚠️ Proxy works but baseline inconsistent", {
          duration: 20000,
          description: `Step 1: ${baseline1Ip}\nStep 2 (proxy): ${proxyIp}\nStep 3: ${baseline2Ip}\n\nProxy IP differs but baseline IPs don't match. Network may be unstable.`,
        });
      } else {
        toast.error("❌ Proxy NOT working", {
          duration: 20000,
          description: `Step 1: ${baseline1Ip}\nStep 2 (proxy): ${proxyIp}\nStep 3: ${baseline2Ip}\n\nProxy IP matches baseline. Check credentials.`,
        });
      }
    } else if (data?.error) {
      toast.error(data.error);
    }
    return data;
  }, [callAgent]);

  const syncOrderEmails = useCallback(async () => {
    if (!user || isSyncingEmails) return;

    setIsSyncingEmails(true);
    toast.info("Searching Gmail for order emails... This may take 2-3 minutes.");

    const data = await callAgent("sync_order_emails");

    if (data?.success) {
      toast.success(`Found ${data.inserted} new order emails!`, {
        description: data.totalFound > 0 ? `Total found: ${data.totalFound}, Skipped duplicates: ${data.skipped}` : undefined,
      });
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
    cancelLogin,
    restartSession,
    cleanupSessions,
    syncOrders,
    syncOrderEmails,
    setProxy,
    clearProxy,
    testProxy,
    toggleBrowserstack,
    refetch: fetchStatus,
  };
}
