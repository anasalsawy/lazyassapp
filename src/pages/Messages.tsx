import { useState } from "react";
import { useEmailInbox } from "@/hooks/useEmailInbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Mail, Inbox, Search, Star, Trash2, 
  RefreshCw, Calendar, Building2, Reply,
  Sparkles, AlertCircle, CheckCircle, XCircle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const sentimentConfig: Record<string, { color: string; icon: any; label: string }> = {
  interview_request: { color: "bg-success/10 text-success", icon: Calendar, label: "Interview Request" },
  positive: { color: "bg-accent/10 text-accent", icon: CheckCircle, label: "Positive" },
  neutral: { color: "bg-muted text-muted-foreground", icon: Mail, label: "Neutral" },
  negative: { color: "bg-warning/10 text-warning", icon: AlertCircle, label: "Concerning" },
  rejection: { color: "bg-destructive/10 text-destructive", icon: XCircle, label: "Rejection" },
};

const Messages = () => {
  const { emails, emailAccount, loading, stats, createEmailAccount, markAsRead, deleteEmail, refetch } = useEmailInbox();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [newEmail, setNewEmail] = useState("");

  const filteredEmails = emails.filter(email => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      email.subject.toLowerCase().includes(query) ||
      email.from_name?.toLowerCase().includes(query) ||
      email.from_email.toLowerCase().includes(query)
    );
  });

  const handleEmailClick = (email: any) => {
    setSelectedEmail(email);
    if (!email.is_read) {
      markAsRead(email.id);
    }
  };

  const handleSetupEmail = async () => {
    if (newEmail) {
      await createEmailAccount(newEmail);
      setShowSetup(false);
      setNewEmail("");
    }
  };

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Email Inbox</h1>
          <p className="text-muted-foreground mt-1">
            AI-analyzed emails from recruiters and companies
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refetch}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {!emailAccount && (
            <Button onClick={() => setShowSetup(true)}>
              <Mail className="w-4 h-4 mr-2" />
              Setup Email
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Inbox className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              <div>
                <p className="text-2xl font-bold">{stats.unread}</p>
                <p className="text-xs text-muted-foreground">Unread</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-success" />
              <div>
                <p className="text-2xl font-bold">{stats.interviews}</p>
                <p className="text-xs text-muted-foreground">Interviews</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-accent" />
              <div>
                <p className="text-2xl font-bold">{stats.positive}</p>
                <p className="text-xs text-muted-foreground">Positive</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              <div>
                <p className="text-2xl font-bold">{stats.rejections}</p>
                <p className="text-xs text-muted-foreground">Rejections</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="glass-card rounded-2xl p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Email Account Status */}
      {emailAccount && (
        <div className="glass-card rounded-2xl p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="font-medium">{emailAccount.email_address}</p>
              <p className="text-sm text-muted-foreground">
                {emailAccount.last_synced_at 
                  ? `Last synced ${formatDistanceToNow(new Date(emailAccount.last_synced_at), { addSuffix: true })}`
                  : "Not synced yet"
                }
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="bg-success/10 text-success">
            Connected
          </Badge>
        </div>
      )}

      {/* Emails List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="h-5 bg-secondary rounded w-1/3 mb-2" />
              <div className="h-4 bg-secondary rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : filteredEmails.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Inbox className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {emailAccount ? "No emails yet" : "Set up your email inbox"}
          </h3>
          <p className="text-muted-foreground max-w-sm mx-auto mb-6">
            {emailAccount 
              ? "When you receive responses from recruiters or companies, they'll appear here with AI analysis."
              : "Connect an email address to receive and manage recruiter responses automatically."
            }
          </p>
          {!emailAccount && (
            <Button onClick={() => setShowSetup(true)}>
              <Mail className="w-4 h-4 mr-2" />
              Setup Email Inbox
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEmails.map((email) => {
            const sentiment = sentimentConfig[email.ai_sentiment || "neutral"];
            const SentimentIcon = sentiment.icon;
            
            return (
              <div
                key={email.id}
                onClick={() => handleEmailClick(email)}
                className={`glass-card rounded-xl p-4 cursor-pointer hover:shadow-md transition-all ${
                  !email.is_read ? "border-l-4 border-l-primary bg-primary/5" : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-medium ${!email.is_read ? "text-foreground" : "text-muted-foreground"}`}>
                          {email.from_name || email.from_email.split("@")[0]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className={`text-sm ${!email.is_read ? "font-medium" : ""} truncate`}>
                        {email.subject}
                      </p>
                      {email.ai_summary && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          <Sparkles className="w-3 h-3 inline mr-1" />
                          {email.ai_summary}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Badge className={sentiment.color}>
                      <SentimentIcon className="w-3 h-3 mr-1" />
                      {sentiment.label}
                    </Badge>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteEmail(email.id);
                      }}
                      className="p-1.5 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Email Detail Dialog */}
      <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedEmail && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedEmail.subject}</DialogTitle>
                <DialogDescription>
                  From: {selectedEmail.from_name || selectedEmail.from_email} 
                  <span className="text-muted-foreground"> • {formatDistanceToNow(new Date(selectedEmail.received_at), { addSuffix: true })}</span>
                </DialogDescription>
              </DialogHeader>
              
              {/* AI Analysis */}
              {(selectedEmail.ai_summary || selectedEmail.ai_sentiment) && (
                <Card className="mt-4 border-primary/20 bg-primary/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      AI Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedEmail.ai_sentiment && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Sentiment:</span>
                        <Badge className={sentimentConfig[selectedEmail.ai_sentiment]?.color}>
                          {sentimentConfig[selectedEmail.ai_sentiment]?.label}
                        </Badge>
                      </div>
                    )}
                    {selectedEmail.ai_summary && (
                      <div>
                        <span className="text-sm text-muted-foreground">Summary:</span>
                        <p className="text-sm mt-1">{selectedEmail.ai_summary}</p>
                      </div>
                    )}
                    {selectedEmail.ai_suggested_reply && (
                      <div>
                        <span className="text-sm text-muted-foreground">Suggested Reply:</span>
                        <p className="text-sm mt-1 p-3 bg-background rounded-lg border">
                          {selectedEmail.ai_suggested_reply}
                        </p>
                        <Button size="sm" className="mt-2">
                          <Reply className="w-4 h-4 mr-2" />
                          Use This Reply
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Email Body */}
              <div className="mt-4 p-4 bg-secondary/50 rounded-lg">
                <div 
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ 
                    __html: selectedEmail.body_html || selectedEmail.body_text?.replace(/\n/g, "<br>") || "No content" 
                  }}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Setup Email Dialog */}
      <Dialog open={showSetup} onOpenChange={setShowSetup}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Setup Email Inbox</DialogTitle>
            <DialogDescription>
              Enter an email address where recruiters can reach you. 
              We'll automatically analyze incoming emails and link them to your applications.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium">Email Address</label>
              <Input
                type="email"
                placeholder="your@email.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="bg-muted/50 p-4 rounded-lg">
              <h4 className="font-medium text-sm mb-2">How it works</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Emails sent to this address are analyzed by AI</li>
                <li>• Interview requests and rejections are auto-detected</li>
                <li>• Emails are linked to your job applications</li>
                <li>• AI suggests reply drafts for common responses</li>
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSetup(false)}>
                Cancel
              </Button>
              <Button onClick={handleSetupEmail} disabled={!newEmail}>
                Connect Email
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Messages;
