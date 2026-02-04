import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import {
  ExternalLink,
  Calendar,
  Clock,
  FileText,
  Send,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Loader2,
  ArrowRight,
} from "lucide-react";

interface ApplicationLog {
  id: string;
  created_at: string;
  log_level: string;
  message: string;
  agent_name: string;
}

interface StatusHistoryItem {
  id: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface Application {
  id: string;
  job_id: string;
  platform: string;
  job_title: string | null;
  company_name: string | null;
  job_url: string | null;
  status: string;
  status_message: string | null;
  applied_at: string;
  notes?: string | null;
  cover_letter?: string | null;
  extra_metadata?: Record<string, any> | null;
  job?: {
    title: string;
    company: string;
    location: string | null;
    url: string | null;
    description?: string | null;
  };
}

type DrawerType = "logs" | "details" | "offer" | "reason" | "resolve";

interface ApplicationDrawerProps {
  application: Application | null;
  type: DrawerType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

export function ApplicationDrawer({
  application,
  type,
  open,
  onOpenChange,
  onRefresh,
}: ApplicationDrawerProps) {
  const { toast } = useToast();
  const [logs, setLogs] = useState<ApplicationLog[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [userResponse, setUserResponse] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch logs when drawer opens for "logs" type
  const fetchLogs = async () => {
    if (!application) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_logs")
        .select("*")
        .contains("metadata", { applicationId: application.id })
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setLogs(data || []);
    } catch (error: any) {
      console.error("Error fetching logs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch status history
  const fetchStatusHistory = async () => {
    if (!application) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("application_status_history")
        .select("*")
        .eq("application_id", application.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setStatusHistory(data || []);
    } catch (error: any) {
      console.error("Error fetching status history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle resolve action (for needs-user-action status)
  const handleResolve = async () => {
    if (!application || !userResponse.trim()) return;
    setIsSubmitting(true);
    try {
      // Update application with user's response and change status
      const { error } = await supabase
        .from("applications")
        .update({
          status: "pending-apply",
          notes: userResponse,
          status_message: "User provided response, ready to retry",
        })
        .eq("id", application.id);

      if (error) throw error;

      toast({ title: "Response submitted", description: "The agent will retry the application." });
      onOpenChange(false);
      onRefresh?.();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load data when drawer opens
  if (open && application) {
    if (type === "logs" && logs.length === 0 && !isLoading) {
      fetchLogs();
    }
    if ((type === "details" || type === "offer") && statusHistory.length === 0 && !isLoading) {
      fetchStatusHistory();
    }
  }

  if (!application) return null;

  const getTitle = () => {
    switch (type) {
      case "logs":
        return "Application Logs";
      case "details":
        return "Interview Details";
      case "offer":
        return "Offer Details";
      case "reason":
        return "Rejection Details";
      case "resolve":
        return "Action Required";
      default:
        return "Application Details";
    }
  };

  const getDescription = () => {
    switch (type) {
      case "logs":
        return "View agent activity logs for this application";
      case "details":
        return "Interview invitation and scheduling information";
      case "offer":
        return "Congratulations! Here are your offer details";
      case "reason":
        return "Feedback from the employer";
      case "resolve":
        return "The agent needs your input to continue";
      default:
        return "";
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {type === "logs" && <FileText className="w-5 h-5" />}
            {type === "details" && <Calendar className="w-5 h-5" />}
            {type === "offer" && <CheckCircle2 className="w-5 h-5 text-success" />}
            {type === "reason" && <XCircle className="w-5 h-5 text-destructive" />}
            {type === "resolve" && <AlertCircle className="w-5 h-5 text-warning" />}
            {getTitle()}
          </SheetTitle>
          <SheetDescription>{getDescription()}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Job Info Header */}
          <div className="p-4 rounded-lg bg-secondary/50">
            <h3 className="font-semibold">
              {application.job_title || application.job?.title || "Unknown Position"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {application.company_name || application.job?.company || "Unknown Company"}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="capitalize">
                {application.platform || "other"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Applied {formatDistanceToNow(new Date(application.applied_at), { addSuffix: true })}
              </span>
            </div>
          </div>

          <Separator />

          {/* Content based on type */}
          <ScrollArea className="h-[calc(100vh-320px)]">
            {type === "logs" && (
              <div className="space-y-3">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : logs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No logs found for this application</p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-3 rounded-lg border text-sm ${
                        log.log_level === "error"
                          ? "border-destructive/50 bg-destructive/5"
                          : log.log_level === "warn"
                          ? "border-warning/50 bg-warning/5"
                          : "border-border bg-card"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            log.log_level === "error"
                              ? "text-destructive"
                              : log.log_level === "warn"
                              ? "text-warning"
                              : "text-muted-foreground"
                          }`}
                        >
                          {log.agent_name}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-foreground">{log.message}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            {(type === "details" || type === "offer") && (
              <div className="space-y-4">
                {/* Status Message */}
                {application.status_message && (
                  <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2 mb-2">
                      {type === "offer" ? (
                        <CheckCircle2 className="w-4 h-4 text-success" />
                      ) : (
                        <MessageSquare className="w-4 h-4 text-primary" />
                      )}
                      <span className="font-medium">
                        {type === "offer" ? "Offer Information" : "Interview Information"}
                      </span>
                    </div>
                    <p className="text-sm">{application.status_message}</p>
                  </div>
                )}

                {/* Extra metadata */}
                {application.extra_metadata && Object.keys(application.extra_metadata).length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Details</h4>
                    <div className="grid gap-2">
                      {Object.entries(application.extra_metadata).map(([key, value]) => (
                        <div key={key} className="flex justify-between text-sm">
                          <span className="text-muted-foreground capitalize">
                            {key.replace(/_/g, " ")}
                          </span>
                          <span className="font-medium">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Status History */}
                {statusHistory.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Status Timeline</h4>
                    <div className="space-y-2">
                      {statusHistory.map((item, idx) => (
                        <div key={item.id} className="flex items-start gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-2 h-2 rounded-full bg-primary" />
                            {idx < statusHistory.length - 1 && (
                              <div className="w-0.5 h-8 bg-border" />
                            )}
                          </div>
                          <div className="flex-1 pb-2">
                            <div className="flex items-center justify-between">
                              <Badge variant="secondary" className="text-xs capitalize">
                                {item.status.replace(/-/g, " ")}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                              </span>
                            </div>
                            {item.notes && (
                              <p className="text-sm text-muted-foreground mt-1">{item.notes}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 pt-4">
                  {(application.job_url || application.job?.url) && (
                    <Button variant="outline" asChild className="flex-1">
                      <a
                        href={application.job_url || application.job?.url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        View Job
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {type === "reason" && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-destructive" />
                    <span className="font-medium">Application Declined</span>
                  </div>
                  <p className="text-sm">
                    {application.status_message ||
                      "Unfortunately, the employer has decided not to move forward with your application at this time."}
                  </p>
                </div>

                {application.notes && (
                  <div className="p-4 rounded-lg bg-secondary/50">
                    <h4 className="text-sm font-medium mb-2">Feedback</h4>
                    <p className="text-sm text-muted-foreground">{application.notes}</p>
                  </div>
                )}

                <p className="text-sm text-muted-foreground">
                  Don't be discouraged! Keep applying - the right opportunity is out there.
                </p>
              </div>
            )}

            {type === "resolve" && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-warning/10 border border-warning/30">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-warning" />
                    <span className="font-medium">Input Required</span>
                  </div>
                  <p className="text-sm">
                    {application.status_message ||
                      "The agent encountered a question or prompt that requires your input to continue the application."}
                  </p>
                </div>

                {/* Suggested answer if available */}
                {application.extra_metadata?.suggestedAnswer && (
                  <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <h4 className="text-sm font-medium mb-2">Suggested Answer</h4>
                    <p className="text-sm">{application.extra_metadata.suggestedAnswer}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => setUserResponse(application.extra_metadata?.suggestedAnswer || "")}
                    >
                      Use this answer
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                )}

                {/* User response input */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Your Response</h4>
                  <Textarea
                    placeholder="Enter your response here..."
                    value={userResponse}
                    onChange={(e) => setUserResponse(e.target.value)}
                    rows={4}
                  />
                </div>

                <Button
                  onClick={handleResolve}
                  disabled={!userResponse.trim() || isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Submit & Retry Application
                </Button>
              </div>
            )}
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
