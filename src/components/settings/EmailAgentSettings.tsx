import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, RefreshCw, Unplug, AlertCircle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useEmailAgent } from "@/hooks/useEmailAgent";
import { formatDistanceToNow } from "date-fns";

export function EmailAgentSettings() {
  const {
    connections,
    settings,
    oauthAvailable,
    isLoading,
    isSyncing,
    connectProvider,
    disconnectProvider,
    updateSettings,
    syncEmails,
  } = useEmailAgent();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" /> Connected</Badge>;
      case "expired":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Expired</Badge>;
      case "needs_verification":
        return <Badge className="bg-yellow-500"><AlertCircle className="h-3 w-3 mr-1" /> Needs Verification</Badge>;
      case "error":
        return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" /> Error</Badge>;
      default:
        return <Badge variant="secondary">Disconnected</Badge>;
    }
  };

  const gmailConnection = connections.find((c) => c.provider === "gmail" && c.status === "connected");
  const outlookConnection = connections.find((c) => c.provider === "outlook" && c.status === "connected");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Email Connections */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Connections
          </CardTitle>
          <CardDescription>
            Connect your email accounts to automatically process job-related emails
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Gmail */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-red-600">
                  <path fill="currentColor" d="M20 18h-2V9.25L12 13 6 9.25V18H4V6h1.2l6.8 4.25L18.8 6H20m0-2H4c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z"/>
                </svg>
              </div>
              <div>
                <div className="font-medium">Gmail</div>
                {gmailConnection && (
                  <div className="text-sm text-muted-foreground">
                    {gmailConnection.email_address}
                    {gmailConnection.last_sync_at && (
                      <span className="ml-2">
                        · Last synced {formatDistanceToNow(new Date(gmailConnection.last_sync_at))} ago
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {gmailConnection && getStatusBadge(gmailConnection.status)}
              {gmailConnection ? (
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => syncEmails(gmailConnection.id)}
                    disabled={isSyncing}
                  >
                    {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Sync
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => disconnectProvider(gmailConnection.id)}
                  >
                    <Unplug className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button 
                  onClick={() => connectProvider("gmail")}
                  disabled={!oauthAvailable.gmail}
                >
                  {oauthAvailable.gmail ? "Connect Gmail" : "Not Configured"}
                </Button>
              )}
            </div>
          </div>

          {/* Outlook */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-600">
                  <path fill="currentColor" d="M7,12L12,3L17,12L12,21L7,12M21,5V19L17,12L21,5M3,5V19L7,12L3,5Z"/>
                </svg>
              </div>
              <div>
                <div className="font-medium">Outlook</div>
                {outlookConnection && (
                  <div className="text-sm text-muted-foreground">
                    {outlookConnection.email_address}
                    {outlookConnection.last_sync_at && (
                      <span className="ml-2">
                        · Last synced {formatDistanceToNow(new Date(outlookConnection.last_sync_at))} ago
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {outlookConnection && getStatusBadge(outlookConnection.status)}
              {outlookConnection ? (
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => syncEmails(outlookConnection.id)}
                    disabled={isSyncing}
                  >
                    {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Sync
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => disconnectProvider(outlookConnection.id)}
                  >
                    <Unplug className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button 
                  onClick={() => connectProvider("outlook")}
                  disabled={!oauthAvailable.outlook}
                >
                  {oauthAvailable.outlook ? "Connect Outlook" : "Not Configured"}
                </Button>
              )}
            </div>
          </div>

          {!oauthAvailable.gmail && !oauthAvailable.outlook && (
            <div className="p-4 bg-muted rounded-lg text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 inline mr-2" />
              OAuth not configured. Add GOOGLE_CLIENT_ID/SECRET and MICROSOFT_CLIENT_ID/SECRET to enable email connections.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Email Agent Settings</CardTitle>
          <CardDescription>
            Configure how the AI processes your job-related emails
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enabled">Enable Email Agent</Label>
              <p className="text-sm text-muted-foreground">
                Automatically process incoming job emails
              </p>
            </div>
            <Switch
              id="enabled"
              checked={settings.enabled}
              onCheckedChange={(enabled) => updateSettings({ enabled })}
              disabled={connections.filter(c => c.status === "connected").length === 0}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="read_emails">Read Job Emails</Label>
              <p className="text-sm text-muted-foreground">
                Classify and extract data from job-related emails
              </p>
            </div>
            <Switch
              id="read_emails"
              checked={settings.read_emails}
              onCheckedChange={(read_emails) => updateSettings({ read_emails })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto_create_drafts">Auto-Create Drafts</Label>
              <p className="text-sm text-muted-foreground">
                Generate reply drafts for interview requests
              </p>
            </div>
            <Switch
              id="auto_create_drafts"
              checked={settings.auto_create_drafts}
              onCheckedChange={(auto_create_drafts) => updateSettings({ auto_create_drafts })}
            />
          </div>

          <div className="border-t pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="allow_sending">Allow Sending Emails</Label>
                <p className="text-sm text-muted-foreground">
                  Enable the agent to send approved emails on your behalf
                </p>
              </div>
              <Switch
                id="allow_sending"
                checked={settings.allow_sending}
                onCheckedChange={(allow_sending) => updateSettings({ allow_sending })}
              />
            </div>

            {settings.allow_sending && (
              <div className="ml-4 p-4 bg-muted/50 rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="send_mode">Send Mode</Label>
                  <Select
                    value={settings.send_mode}
                    onValueChange={(send_mode: "draft_only" | "auto_send") => 
                      updateSettings({ send_mode })
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft_only">Draft Only (Recommended)</SelectItem>
                      <SelectItem value="auto_send">Auto-Send Confirmations</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {settings.send_mode === "auto_send" && (
                  <p className="text-sm text-yellow-600 dark:text-yellow-400">
                    <AlertCircle className="h-4 w-4 inline mr-1" />
                    Auto-send is limited to simple confirmation templates only.
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
