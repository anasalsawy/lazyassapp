import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

interface EmailConnection {
  id: string;
  provider: "gmail" | "outlook";
  email_address: string;
  status: "pending" | "connected" | "expired" | "error" | "needs_verification" | "disconnected";
  last_sync_at: string | null;
  created_at: string;
}

interface EmailAgentSettings {
  enabled: boolean;
  read_emails: boolean;
  auto_create_drafts: boolean;
  allow_sending: boolean;
  send_mode: "draft_only" | "auto_send";
}

interface OAuthAvailability {
  gmail: boolean;
  outlook: boolean;
}

interface JobEmail {
  id: string;
  provider: string;
  message_id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  snippet: string | null;
  received_at: string;
  classification: string;
  confidence: number;
  extracted_json: Record<string, unknown>;
  linked_application_id: string | null;
  is_read: boolean;
  applications?: {
    id: string;
    status: string;
    jobs: { title: string; company: string };
  } | null;
}

interface EmailDraft {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  status: "draft" | "approved" | "sent" | "failed";
  created_at: string;
  job_emails?: {
    subject: string;
    from_email: string;
    from_name: string | null;
    classification: string;
  } | null;
}

export function useEmailAgent() {
  const { user, session } = useAuth();
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [settings, setSettings] = useState<EmailAgentSettings>({
    enabled: false,
    read_emails: true,
    auto_create_drafts: true,
    allow_sending: false,
    send_mode: "draft_only",
  });
  const [oauthAvailable, setOauthAvailable] = useState<OAuthAvailability>({
    gmail: false,
    outlook: false,
  });
  const [jobEmails, setJobEmails] = useState<JobEmail[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [emailCounts, setEmailCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    if (!session?.access_token) return;

    try {
      const response = await supabase.functions.invoke("email-oauth/status", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (response.error) throw response.error;

      const data = response.data;
      setConnections(data.connections || []);
      setSettings(data.settings || settings);
      setOauthAvailable(data.oauth_available || { gmail: false, outlook: false });
    } catch (error) {
      console.error("Failed to fetch email status:", error);
    } finally {
      setIsLoading(false);
    }
  }, [session?.access_token]);

  // Fetch job inbox
  const fetchInbox = useCallback(async (classification?: string) => {
    if (!session?.access_token) return;

    try {
      const params = new URLSearchParams();
      if (classification) params.set("classification", classification);

      const response = await supabase.functions.invoke(`email-processor/inbox?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (response.error) throw response.error;

      setJobEmails(response.data.emails || []);
      setEmailCounts(response.data.counts || {});
    } catch (error) {
      console.error("Failed to fetch inbox:", error);
    }
  }, [session?.access_token]);

  // Fetch drafts
  const fetchDrafts = useCallback(async () => {
    if (!session?.access_token) return;

    try {
      const response = await supabase.functions.invoke("email-processor/drafts", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (response.error) throw response.error;

      setDrafts(response.data.drafts || []);
    } catch (error) {
      console.error("Failed to fetch drafts:", error);
    }
  }, [session?.access_token]);

  // Start OAuth flow
  const connectProvider = useCallback(async (provider: "gmail" | "outlook", includeSend = false) => {
    if (!session?.access_token) {
      toast.error("Please sign in first");
      return;
    }

    try {
      const redirectUri = `${window.location.origin}/settings?oauth_callback=true`;
      
      const response = await supabase.functions.invoke("email-oauth/start", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { provider, includeSend, redirectUri },
      });

      if (response.error) throw response.error;

      const { authUrl } = response.data;

      // Open OAuth popup
      const popup = window.open(authUrl, "oauth", "width=600,height=700,popup=true");

      // Listen for callback
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === "oauth_success") {
          toast.success(`Connected ${event.data.email}`);
          fetchStatus();
          popup?.close();
        } else if (event.data?.type === "oauth_error") {
          toast.error(`Connection failed: ${event.data.error}`);
          popup?.close();
        }
        window.removeEventListener("message", handleMessage);
      };

      window.addEventListener("message", handleMessage);
    } catch (error) {
      console.error("OAuth error:", error);
      toast.error("Failed to start OAuth flow");
    }
  }, [session?.access_token, fetchStatus]);

  // Disconnect provider
  const disconnectProvider = useCallback(async (connectionId: string) => {
    if (!session?.access_token) return;

    try {
      const response = await supabase.functions.invoke("email-oauth/disconnect", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { connectionId },
      });

      if (response.error) throw response.error;

      toast.success("Email disconnected");
      fetchStatus();
    } catch (error) {
      console.error("Disconnect error:", error);
      toast.error("Failed to disconnect");
    }
  }, [session?.access_token, fetchStatus]);

  // Update settings
  const updateSettings = useCallback(async (newSettings: Partial<EmailAgentSettings>) => {
    if (!session?.access_token) return;

    try {
      const response = await supabase.functions.invoke("email-oauth/settings", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: newSettings,
      });

      if (response.error) throw response.error;

      setSettings((prev) => ({ ...prev, ...newSettings }));
      toast.success("Settings updated");
    } catch (error) {
      console.error("Settings update error:", error);
      toast.error("Failed to update settings");
    }
  }, [session?.access_token]);

  // Sync emails
  const syncEmails = useCallback(async (connectionId: string) => {
    if (!session?.access_token) return;

    setIsSyncing(true);
    try {
      const response = await supabase.functions.invoke("email-processor/sync", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { connectionId },
      });

      if (response.error) throw response.error;

      toast.success(`Synced ${response.data.processed} new emails`);
      fetchInbox();
      fetchStatus();
    } catch (error) {
      console.error("Sync error:", error);
      toast.error("Failed to sync emails");
    } finally {
      setIsSyncing(false);
    }
  }, [session?.access_token, fetchInbox, fetchStatus]);

  // Send draft
  const sendDraft = useCallback(async (draftId: string, body?: string) => {
    if (!session?.access_token) return;

    try {
      const response = await supabase.functions.invoke("email-processor/send", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { draftId, body },
      });

      if (response.error) throw response.error;

      toast.success("Email sent!");
      fetchDrafts();
    } catch (error: any) {
      console.error("Send error:", error);
      toast.error(error.message || "Failed to send email");
    }
  }, [session?.access_token, fetchDrafts]);

  // Update draft
  const updateDraft = useCallback(async (draftId: string, subject: string, body: string) => {
    if (!session?.access_token) return;

    try {
      const response = await supabase.functions.invoke("email-processor/update", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { draftId, subject, body },
      });

      if (response.error) throw response.error;

      toast.success("Draft updated");
      fetchDrafts();
    } catch (error) {
      console.error("Update error:", error);
      toast.error("Failed to update draft");
    }
  }, [session?.access_token, fetchDrafts]);

  // Initial fetch
  useEffect(() => {
    if (user) {
      fetchStatus();
    }
  }, [user, fetchStatus]);

  return {
    connections,
    settings,
    oauthAvailable,
    jobEmails,
    drafts,
    emailCounts,
    isLoading,
    isSyncing,
    connectProvider,
    disconnectProvider,
    updateSettings,
    syncEmails,
    fetchInbox,
    fetchDrafts,
    sendDraft,
    updateDraft,
    refetch: fetchStatus,
  };
}
