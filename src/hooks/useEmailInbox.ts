import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface IncomingEmail {
  id: string;
  user_id: string;
  email_account_id: string | null;
  application_id: string | null;
  from_email: string;
  from_name: string | null;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  is_read: boolean;
  is_replied: boolean;
  ai_summary: string | null;
  ai_sentiment: string | null;
  ai_suggested_reply: string | null;
  received_at: string;
  created_at: string;
}

interface EmailAccount {
  id: string;
  user_id: string;
  email_address: string;
  email_provider: string;
  is_active: boolean;
  last_synced_at: string | null;
}

export const useEmailInbox = () => {
  const { user } = useAuth();
  const [emails, setEmails] = useState<IncomingEmail[]>([]);
  const [emailAccount, setEmailAccount] = useState<EmailAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      fetchEmails();
      fetchEmailAccount();
    } else {
      setEmails([]);
      setEmailAccount(null);
      setLoading(false);
    }
  }, [user]);

  const fetchEmails = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("incoming_emails")
        .select("*")
        .eq("user_id", user.id)
        .order("received_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setEmails((data || []) as unknown as IncomingEmail[]);
    } catch (error: any) {
      console.error("Error fetching emails:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmailAccount = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("email_accounts")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error && error.code !== "PGRST116") throw error;
      setEmailAccount(data as unknown as EmailAccount);
    } catch (error: any) {
      console.error("Error fetching email account:", error);
    }
  };

  const createEmailAccount = async (emailAddress: string, provider: string = "mailgun") => {
    if (!user) return null;

    try {
      const { data, error } = await supabase
        .from("email_accounts")
        .insert({
          user_id: user.id,
          email_address: emailAddress,
          email_provider: provider,
        })
        .select()
        .single();

      if (error) throw error;
      setEmailAccount(data as unknown as EmailAccount);
      toast({ title: "Email account created" });
      return data;
    } catch (error: any) {
      console.error("Error creating email account:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create email account",
        variant: "destructive",
      });
      return null;
    }
  };

  const markAsRead = async (emailId: string) => {
    try {
      const { error } = await supabase
        .from("incoming_emails")
        .update({ is_read: true })
        .eq("id", emailId);

      if (error) throw error;
      setEmails(prev => prev.map(e => e.id === emailId ? { ...e, is_read: true } : e));
    } catch (error: any) {
      console.error("Error marking email as read:", error);
    }
  };

  const deleteEmail = async (emailId: string) => {
    try {
      const { error } = await supabase
        .from("incoming_emails")
        .delete()
        .eq("id", emailId);

      if (error) throw error;
      setEmails(prev => prev.filter(e => e.id !== emailId));
      toast({ title: "Email deleted" });
    } catch (error: any) {
      console.error("Error deleting email:", error);
    }
  };

  const stats = {
    total: emails.length,
    unread: emails.filter(e => !e.is_read).length,
    interviews: emails.filter(e => e.ai_sentiment === "interview_request").length,
    rejections: emails.filter(e => e.ai_sentiment === "rejection").length,
    positive: emails.filter(e => e.ai_sentiment === "positive").length,
  };

  return {
    emails,
    emailAccount,
    loading,
    stats,
    createEmailAccount,
    markAsRead,
    deleteEmail,
    refetch: fetchEmails,
  };
};
