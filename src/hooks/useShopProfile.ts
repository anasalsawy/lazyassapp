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

    console.log(`[ShopProfile] callAgent: action=${action}`);

    try {
      const { data, error } = await supabase.functions.invoke("auto-shop", {
        body: { action, ...body },
      });

      if (error) {
        const errorMessage = error.message || "";
        if (errorMessage.includes("credits") || errorMessage.includes("INSUFFICIENT")) {
          toast.error("Skyvern API credits insufficient", {
            description: "Please add credits to your Skyvern account to continue.",
            duration: 10000,
          });
          return { success: false, code: "INSUFFICIENT_CREDITS" };
        }
        throw error;
      }

      if (data?.code === "INSUFFICIENT_CREDITS") {
        toast.error("Skyvern API credits insufficient", {
          description: "Please add credits to your Skyvern account to continue.",
          duration: 10000,
        });
        return data;
      }

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

  // Sync orders every 30 seconds
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
    refetch: fetchStatus,
  };
}
