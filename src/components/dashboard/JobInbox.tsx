import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Inbox, 
  Mail, 
  MailCheck, 
  Calendar, 
  XCircle, 
  FileText, 
  ShieldCheck,
  Key,
  MoreHorizontal,
  ExternalLink,
  Loader2,
  RefreshCw
} from "lucide-react";
import { useEmailAgent } from "@/hooks/useEmailAgent";
import { formatDistanceToNow } from "date-fns";

const CLASSIFICATION_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  application_confirmation: { 
    label: "Confirmation", 
    icon: <MailCheck className="h-4 w-4" />, 
    color: "bg-green-500" 
  },
  interview_request: { 
    label: "Interview", 
    icon: <Calendar className="h-4 w-4" />, 
    color: "bg-blue-500" 
  },
  rejection: { 
    label: "Rejection", 
    icon: <XCircle className="h-4 w-4" />, 
    color: "bg-red-500" 
  },
  assessment: { 
    label: "Assessment", 
    icon: <FileText className="h-4 w-4" />, 
    color: "bg-purple-500" 
  },
  verification: { 
    label: "Verification", 
    icon: <ShieldCheck className="h-4 w-4" />, 
    color: "bg-orange-500" 
  },
  mfa_code: { 
    label: "MFA Code", 
    icon: <Key className="h-4 w-4" />, 
    color: "bg-yellow-500" 
  },
  other_job_related: { 
    label: "Other", 
    icon: <MoreHorizontal className="h-4 w-4" />, 
    color: "bg-gray-500" 
  },
};

export function JobInbox() {
  const { 
    jobEmails, 
    emailCounts, 
    connections,
    isLoading, 
    isSyncing,
    fetchInbox,
    syncEmails 
  } = useEmailAgent();
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    fetchInbox(activeTab === "all" ? undefined : activeTab);
  }, [activeTab, fetchInbox]);

  const connectedConnection = connections.find(c => c.status === "connected");

  const getClassificationBadge = (classification: string) => {
    const config = CLASSIFICATION_CONFIG[classification] || CLASSIFICATION_CONFIG.other_job_related;
    return (
      <Badge className={`${config.color} text-white`}>
        {config.icon}
        <span className="ml-1">{config.label}</span>
      </Badge>
    );
  };

  const getActionButton = (email: any) => {
    const classification = email.classification;
    const extracted = email.extracted_json || {};

    if (classification === "verification" && extracted.action_links?.length > 0) {
      return (
        <Button size="sm" variant="outline" asChild>
          <a href={extracted.action_links[0]} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3 mr-1" />
            Continue Application
          </a>
        </Button>
      );
    }

    if (classification === "interview_request") {
      return (
        <Button size="sm" variant="outline">
          <Mail className="h-3 w-3 mr-1" />
          Open Draft Reply
        </Button>
      );
    }

    return null;
  };

  const totalCount = Object.values(emailCounts).reduce((a, b) => a + b, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-5 w-5" />
              Job Inbox
            </CardTitle>
            <CardDescription>
              Emails related to your job applications, automatically classified
            </CardDescription>
          </div>
          {connectedConnection && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncEmails(connectedConnection.id)}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all" className="gap-1">
              All
              {totalCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                  {totalCount}
                </Badge>
              )}
            </TabsTrigger>
            {Object.entries(CLASSIFICATION_CONFIG).map(([key, config]) => {
              const count = emailCounts[key] || 0;
              if (count === 0 && key !== "interview_request") return null;
              return (
                <TabsTrigger key={key} value={key} className="gap-1">
                  {config.icon}
                  {config.label}
                  {count > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                      {count}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : jobEmails.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Inbox className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No emails found</p>
                {connections.length === 0 && (
                  <p className="text-sm mt-2">
                    Connect your email in Settings to start syncing
                  </p>
                )}
              </div>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {jobEmails.map((email) => (
                    <div
                      key={email.id}
                      className={`p-4 border rounded-lg hover:bg-muted/50 transition-colors ${
                        !email.is_read ? "border-l-4 border-l-primary" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getClassificationBadge(email.classification)}
                            {email.applications && (
                              <Badge variant="outline">
                                {email.applications.jobs?.company} - {email.applications.jobs?.title}
                              </Badge>
                            )}
                          </div>
                          <h4 className="font-medium truncate">{email.subject}</h4>
                          <p className="text-sm text-muted-foreground">
                            {email.from_name || email.from_email}
                          </p>
                          {email.snippet && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {email.snippet}
                            </p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span>{formatDistanceToNow(new Date(email.received_at))} ago</span>
                            {email.extracted_json?.company_name && (
                              <span>Company: {email.extracted_json.company_name as string}</span>
                            )}
                            {email.extracted_json?.deadline && (
                              <span className="text-orange-500">
                                Deadline: {new Date(email.extracted_json.deadline as string).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          {getActionButton(email)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
