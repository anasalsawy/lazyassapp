import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Link2, 
  Unplug, 
  TestTube2, 
  AlertCircle, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  Clock,
  ShieldAlert
} from "lucide-react";
import { useAccountAgent } from "@/hooks/useAccountAgent";
import { formatDistanceToNow } from "date-fns";

export function AccountAgentSettings() {
  const {
    connections,
    supportedSites,
    isLoading,
    isConnecting,
    isTesting,
    startConnect,
    testSession,
    disconnect,
  } = useAccountAgent();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" /> Connected</Badge>;
      case "expired":
        return <Badge variant="destructive"><Clock className="h-3 w-3 mr-1" /> Expired</Badge>;
      case "needs_mfa":
        return <Badge className="bg-yellow-500"><ShieldAlert className="h-3 w-3 mr-1" /> Needs MFA</Badge>;
      case "needs_captcha":
        return <Badge className="bg-orange-500"><AlertCircle className="h-3 w-3 mr-1" /> Needs CAPTCHA</Badge>;
      case "error":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Error</Badge>;
      default:
        return <Badge variant="secondary">Not Connected</Badge>;
    }
  };

  const getConnection = (siteKey: string) => {
    return connections.find((c) => c.site_key === siteKey);
  };

  const renderSiteRow = (site: { key: string; name: string; icon: string }) => {
    const connection = getConnection(site.key);
    const isActive = connection && connection.status !== "disconnected";

    return (
      <div key={site.key} className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg">
            {site.icon}
          </div>
          <div>
            <div className="font-medium">{site.name}</div>
            {connection?.username_hint && isActive && (
              <div className="text-sm text-muted-foreground">
                {connection.username_hint}
                {connection.last_validated_at && (
                  <span className="ml-2">
                    · Verified {formatDistanceToNow(new Date(connection.last_validated_at))} ago
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isActive && getStatusBadge(connection!.status)}
          {isActive ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testSession(connection!.id)}
                disabled={isTesting === connection!.id}
              >
                {isTesting === connection!.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TestTube2 className="h-4 w-4" />
                )}
                Test
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => disconnect(connection!.id)}
              >
                <Unplug className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => startConnect(site.key)}
              disabled={isConnecting === site.key}
            >
              {isConnecting === site.key ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              Connect
            </Button>
          )}
        </div>
      </div>
    );
  };

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Account Connections
        </CardTitle>
        <CardDescription>
          Connect your accounts on job sites and ATS systems to enable automated applications
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="ats" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="ats">ATS Systems</TabsTrigger>
            <TabsTrigger value="job_boards">Job Boards</TabsTrigger>
          </TabsList>

          <TabsContent value="ats" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground mb-4">
              Connect to applicant tracking systems for seamless application submissions.
            </p>
            {supportedSites.ats.map(renderSiteRow)}
          </TabsContent>

          <TabsContent value="job_boards" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground mb-4">
              Connect to job boards to apply directly from Career Compass.
            </p>
            {supportedSites.job_boards.map(renderSiteRow)}
            <div className="p-4 bg-muted rounded-lg text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 inline mr-2" />
              Job board connections are in Phase 2. ATS connections are recommended for the best experience.
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 p-4 border rounded-lg bg-muted/30">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            How Connection Works
          </h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• We never store your passwords - only encrypted session tokens</li>
            <li>• You log in manually in a secure browser session</li>
            <li>• Sessions are validated regularly and you'll be notified if re-authentication is needed</li>
            <li>• If MFA/CAPTCHA is required, you'll complete it yourself</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
