import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  Briefcase,
  Building2,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Shield,
  AlertTriangle,
  ArrowRight
} from "lucide-react";

const PLATFORMS = [
  { 
    key: "gmail", 
    name: "Gmail", 
    icon: Mail, 
    color: "bg-red-500",
    description: "Monitor email for interview invites and recruiter responses"
  },
  { 
    key: "linkedin", 
    name: "LinkedIn", 
    icon: Briefcase, 
    color: "bg-blue-600",
    description: "Search and apply to jobs on LinkedIn"
  },
  { 
    key: "indeed", 
    name: "Indeed", 
    icon: Building2, 
    color: "bg-indigo-500",
    description: "Search and apply to jobs on Indeed"
  },
];

export default function Connections() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [activeSession, setActiveSession] = useState<{
    liveViewUrl: string | null;
    taskId: string | null;
  } | null>(null);
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);

  const startAuthorizationSession = async () => {
    setIsStartingSession(true);
    try {
      const { data, error } = await supabase.functions.invoke("job-agent", {
        body: {
          action: "start_login",
          site: "all", // Open session for all platforms
        },
      });

      if (error) throw error;

      if (data?.liveViewUrl) {
        setActiveSession({
          liveViewUrl: data.liveViewUrl,
          taskId: data.taskId,
        });
        // Open in new tab
        window.open(data.liveViewUrl, "_blank");
      }
    } catch (error: any) {
      console.error("Error starting session:", error);
      toast({
        title: "Failed to start session",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsStartingSession(false);
    }
  };

  const confirmLogins = async () => {
    setIsConfirming(true);
    try {
      // Confirm the logins for all platforms
      const { data, error } = await supabase.functions.invoke("job-agent", {
        body: {
          action: "confirm_login",
          sites: ["gmail", "linkedin", "indeed"],
        },
      });

      if (error) throw error;

      setConnectedPlatforms(data?.sitesLoggedIn || []);
      setActiveSession(null);
      
      toast({
        title: "Authorization Complete!",
        description: "Your agent is now ready to search and apply for jobs.",
      });
    } catch (error: any) {
      console.error("Error confirming logins:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to confirm logins",
        variant: "destructive",
      });
    } finally {
      setIsConfirming(false);
    }
  };

  const goToDashboard = () => {
    navigate("/dashboard");
  };

  const allConnected = connectedPlatforms.length >= PLATFORMS.length;

  return (
    <AppLayout>
      <div className="container max-w-3xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Connect Your Accounts</h1>
          <p className="text-muted-foreground">
            Log in once to your email and job sites. Our agent will use these sessions to search and apply for jobs on your behalf.
          </p>
        </div>

        {/* Security Note */}
        <Alert className="mb-8 border-primary/20 bg-primary/5">
          <Shield className="w-4 h-4" />
          <AlertDescription>
            <strong>Your privacy is protected.</strong> We never store your passwords. 
            We only save secure session tokens, and you can revoke access anytime.
          </AlertDescription>
        </Alert>

        {/* Platforms List */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Platforms to Connect</CardTitle>
            <CardDescription>
              You'll log into these platforms in a secure browser session
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {PLATFORMS.map((platform) => {
              const Icon = platform.icon;
              const isConnected = connectedPlatforms.includes(platform.key);
              
              return (
                <div
                  key={platform.key}
                  className={`
                    flex items-center justify-between p-4 rounded-xl border transition-colors
                    ${isConnected ? "border-success bg-success/5" : "border-border"}
                  `}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl ${platform.color} flex items-center justify-center`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-medium">{platform.name}</h3>
                      <p className="text-sm text-muted-foreground">{platform.description}</p>
                    </div>
                  </div>
                  {isConnected ? (
                    <Badge variant="outline" className="text-success border-success gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Pending</Badge>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Action Section */}
        {!activeSession ? (
          <Card>
            <CardContent className="py-8">
              {allConnected ? (
                <div className="text-center">
                  <CheckCircle2 className="w-16 h-16 text-success mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">All Accounts Connected!</h3>
                  <p className="text-muted-foreground mb-6">
                    Your agent is ready to start searching and applying for jobs.
                  </p>
                  <Button size="lg" onClick={goToDashboard} className="gap-2">
                    Go to Dashboard
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="text-center">
                  <h3 className="text-xl font-semibold mb-2">Start Authorization Session</h3>
                  <p className="text-muted-foreground mb-6">
                    Click below to open a secure browser window. Log into each platform, 
                    then return here and click "I'm Done" to save your sessions.
                  </p>
                  <Button 
                    size="lg" 
                    onClick={startAuthorizationSession}
                    disabled={isStartingSession}
                    className="gap-2"
                  >
                    {isStartingSession ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ExternalLink className="w-4 h-4" />
                    )}
                    Start Authorization Session
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-warning">
            <CardContent className="py-8">
              <div className="text-center">
                <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Authorization Session Active</h3>
                <p className="text-muted-foreground mb-4">
                  A browser window has opened. Please log into:
                </p>
                <ul className="text-left max-w-xs mx-auto mb-6 space-y-2">
                  <li className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-red-500" />
                    Your Gmail account
                  </li>
                  <li className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-blue-600" />
                    Your LinkedIn account
                  </li>
                  <li className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-500" />
                    Your Indeed account
                  </li>
                </ul>
                <div className="flex gap-4 justify-center">
                  <Button 
                    variant="outline"
                    onClick={() => window.open(activeSession.liveViewUrl!, "_blank")}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Reopen Browser
                  </Button>
                  <Button 
                    onClick={confirmLogins}
                    disabled={isConfirming}
                  >
                    {isConfirming ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                    )}
                    I'm Done - Save Sessions
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Skip Option */}
        {!allConnected && (
          <div className="text-center mt-6">
            <Button variant="link" onClick={goToDashboard} className="text-muted-foreground">
              Skip for now - I'll connect later
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
