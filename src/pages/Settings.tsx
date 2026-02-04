import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Settings as SettingsIcon,
  User,
  Briefcase,
  Loader2,
  Save,
  LogOut
} from "lucide-react";

interface Profile {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  location: string | null;
  phone: string | null;
  linkedin_url: string | null;
}

interface JobPreferences {
  job_titles: string[];
  locations: string[];
  remote_preference: string;
  salary_min: number | null;
  salary_max: number | null;
  daily_apply_limit: number;
  auto_apply_enabled: boolean;
}

interface AutomationSettings {
  auto_apply_enabled: boolean;
  daily_apply_limit: number;
  min_match_score: number;
  apply_hours_start: number;
  apply_hours_end: number;
}

export default function Settings() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [profile, setProfile] = useState<Profile>({
    first_name: "",
    last_name: "",
    email: "",
    location: "",
    phone: "",
    linkedin_url: "",
  });
  const [preferences, setPreferences] = useState<JobPreferences>({
    job_titles: [],
    locations: [],
    remote_preference: "any",
    salary_min: null,
    salary_max: null,
    daily_apply_limit: 20,
    auto_apply_enabled: false,
  });
  const [automation, setAutomation] = useState<AutomationSettings>({
    auto_apply_enabled: false,
    daily_apply_limit: 20,
    min_match_score: 70,
    apply_hours_start: 9,
    apply_hours_end: 17,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      fetchData();
    }
  }, [user, authLoading]);

  const fetchData = async () => {
    try {
      const [profileRes, prefsRes, autoRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", user?.id).single(),
        supabase.from("job_preferences").select("*").eq("user_id", user?.id).single(),
        supabase.from("automation_settings").select("*").eq("user_id", user?.id).single(),
      ]);

      if (profileRes.data) {
        setProfile({
          first_name: profileRes.data.first_name || "",
          last_name: profileRes.data.last_name || "",
          email: profileRes.data.email || user?.email || "",
          location: profileRes.data.location || "",
          phone: profileRes.data.phone || "",
          linkedin_url: profileRes.data.linkedin_url || "",
        });
      }

      if (prefsRes.data) {
        setPreferences({
          job_titles: prefsRes.data.job_titles || [],
          locations: prefsRes.data.locations || [],
          remote_preference: prefsRes.data.remote_preference || "any",
          salary_min: prefsRes.data.salary_min,
          salary_max: prefsRes.data.salary_max,
          daily_apply_limit: prefsRes.data.daily_apply_limit || 20,
          auto_apply_enabled: prefsRes.data.auto_apply_enabled || false,
        });
      }

      if (autoRes.data) {
        setAutomation({
          auto_apply_enabled: autoRes.data.auto_apply_enabled || false,
          daily_apply_limit: autoRes.data.daily_apply_limit || 20,
          min_match_score: autoRes.data.min_match_score || 70,
          apply_hours_start: autoRes.data.apply_hours_start || 9,
          apply_hours_end: autoRes.data.apply_hours_end || 17,
        });
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await Promise.all([
        supabase.from("profiles").update({
          first_name: profile.first_name,
          last_name: profile.last_name,
          location: profile.location,
          phone: profile.phone,
          linkedin_url: profile.linkedin_url,
        }).eq("user_id", user?.id),

        supabase.from("job_preferences").upsert({
          user_id: user?.id,
          job_titles: preferences.job_titles,
          locations: preferences.locations,
          remote_preference: preferences.remote_preference,
          salary_min: preferences.salary_min,
          salary_max: preferences.salary_max,
          daily_apply_limit: preferences.daily_apply_limit,
          auto_apply_enabled: preferences.auto_apply_enabled,
        }),

        supabase.from("automation_settings").upsert({
          user_id: user?.id,
          auto_apply_enabled: automation.auto_apply_enabled,
          daily_apply_limit: automation.daily_apply_limit,
          min_match_score: automation.min_match_score,
          apply_hours_start: automation.apply_hours_start,
          apply_hours_end: automation.apply_hours_end,
        }),
      ]);

      toast({ title: "Settings saved!" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="container max-w-3xl mx-auto py-8 px-4 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Manage your account and preferences</p>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>

        {/* Profile Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Profile
            </CardTitle>
            <CardDescription>Your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input
                  value={profile.first_name || ""}
                  onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input
                  value={profile.last_name || ""}
                  onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile.email || ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input
                value={profile.location || ""}
                onChange={(e) => setProfile({ ...profile, location: e.target.value })}
                placeholder="San Francisco, CA"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={profile.phone || ""}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>LinkedIn URL</Label>
              <Input
                value={profile.linkedin_url || ""}
                onChange={(e) => setProfile({ ...profile, linkedin_url: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Job Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="w-5 h-5" />
              Job Preferences
            </CardTitle>
            <CardDescription>What kind of jobs are you looking for?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Remote Preference</Label>
              <Select 
                value={preferences.remote_preference} 
                onValueChange={(v) => setPreferences({ ...preferences, remote_preference: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="remote">Remote Only</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="onsite">On-site Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Minimum Salary</Label>
                <Input
                  type="number"
                  value={preferences.salary_min || ""}
                  onChange={(e) => setPreferences({ ...preferences, salary_min: parseInt(e.target.value) || null })}
                />
              </div>
              <div className="space-y-2">
                <Label>Maximum Salary</Label>
                <Input
                  type="number"
                  value={preferences.salary_max || ""}
                  onChange={(e) => setPreferences({ ...preferences, salary_max: parseInt(e.target.value) || null })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Automation Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SettingsIcon className="w-5 h-5" />
              Automation Settings
            </CardTitle>
            <CardDescription>Control how the agent applies to jobs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-Apply</Label>
                <p className="text-sm text-muted-foreground">Automatically apply to matching jobs</p>
              </div>
              <Switch
                checked={automation.auto_apply_enabled}
                onCheckedChange={(v) => setAutomation({ ...automation, auto_apply_enabled: v })}
              />
            </div>
            
            <Separator />

            <div className="space-y-4">
              <div>
                <Label>Daily Application Limit: {automation.daily_apply_limit}</Label>
                <Slider
                  value={[automation.daily_apply_limit]}
                  onValueChange={([v]) => setAutomation({ ...automation, daily_apply_limit: v })}
                  min={1}
                  max={50}
                  step={1}
                  className="mt-2"
                />
              </div>

              <div>
                <Label>Minimum Match Score: {automation.min_match_score}%</Label>
                <Slider
                  value={[automation.min_match_score]}
                  onValueChange={([v]) => setAutomation({ ...automation, min_match_score: v })}
                  min={50}
                  max={100}
                  step={5}
                  className="mt-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Apply Hours Start</Label>
                  <Select
                    value={automation.apply_hours_start.toString()}
                    onValueChange={(v) => setAutomation({ ...automation, apply_hours_start: parseInt(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={i.toString()}>
                          {i.toString().padStart(2, "0")}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Apply Hours End</Label>
                  <Select
                    value={automation.apply_hours_end.toString()}
                    onValueChange={(v) => setAutomation({ ...automation, apply_hours_end: parseInt(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={i.toString()}>
                          {i.toString().padStart(2, "0")}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={signOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
