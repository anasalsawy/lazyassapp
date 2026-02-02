import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useJobPreferences } from "@/hooks/useJobPreferences";
import { useProfile } from "@/hooks/useProfile";
import { Loader2, Save, Plus, X, User, Briefcase } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Settings = () => {
  const { profile, updateProfile, loading: profileLoading } = useProfile();
  const { preferences, updatePreferences, loading: prefLoading } = useJobPreferences();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // Profile form state
  const [firstName, setFirstName] = useState(profile?.first_name || "");
  const [lastName, setLastName] = useState(profile?.last_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [location, setLocation] = useState(profile?.location || "");
  const [linkedinUrl, setLinkedinUrl] = useState(profile?.linkedin_url || "");

  // Preferences form state
  const [jobTitles, setJobTitles] = useState<string[]>(preferences?.job_titles || []);
  const [locations, setLocations] = useState<string[]>(preferences?.locations || []);
  const [salaryMin, setSalaryMin] = useState(preferences?.salary_min?.toString() || "");
  const [salaryMax, setSalaryMax] = useState(preferences?.salary_max?.toString() || "");
  const [remotePreference, setRemotePreference] = useState(preferences?.remote_preference || "any");
  const [newTitle, setNewTitle] = useState("");
  const [newLocation, setNewLocation] = useState("");

  const handleAddTitle = () => {
    if (newTitle.trim() && !jobTitles.includes(newTitle.trim())) {
      setJobTitles([...jobTitles, newTitle.trim()]);
      setNewTitle("");
    }
  };

  const handleAddLocation = () => {
    if (newLocation.trim() && !locations.includes(newLocation.trim())) {
      setLocations([...locations, newLocation.trim()]);
      setNewLocation("");
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await updateProfile({
        first_name: firstName,
        last_name: lastName,
        phone,
        location,
        linkedin_url: linkedinUrl,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    try {
      await updatePreferences({
        job_titles: jobTitles,
        locations: locations,
        salary_min: salaryMin ? parseInt(salaryMin) : null,
        salary_max: salaryMax ? parseInt(salaryMax) : null,
        remote_preference: remotePreference,
      });
    } finally {
      setSaving(false);
    }
  };

  if (profileLoading || prefLoading) {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <h1 className="text-2xl lg:text-3xl font-bold text-foreground mb-2">Settings</h1>
      <p className="text-muted-foreground mb-8">Manage your profile and job preferences</p>

      {/* Profile Section */}
      <div className="glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <User className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Profile Information</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="space-y-2">
            <Label htmlFor="firstName">First Name</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="John"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name</Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Doe"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="San Francisco, CA"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="linkedin">LinkedIn URL</Label>
            <Input
              id="linkedin"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/in/johndoe"
            />
          </div>
        </div>

        <Button onClick={handleSaveProfile} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Profile
        </Button>
      </div>

      {/* Job Preferences Section */}
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Briefcase className="w-5 h-5 text-accent" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Job Preferences</h2>
        </div>

        {/* Job Titles */}
        <div className="mb-6">
          <Label className="mb-2 block">Desired Job Titles</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {jobTitles.map((title) => (
              <Badge key={title} variant="secondary" className="gap-1">
                {title}
                <button onClick={() => setJobTitles(jobTitles.filter(t => t !== title))}>
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g., Software Engineer"
              onKeyPress={(e) => e.key === "Enter" && handleAddTitle()}
            />
            <Button variant="outline" onClick={handleAddTitle}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Locations */}
        <div className="mb-6">
          <Label className="mb-2 block">Preferred Locations</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {locations.map((loc) => (
              <Badge key={loc} variant="secondary" className="gap-1">
                {loc}
                <button onClick={() => setLocations(locations.filter(l => l !== loc))}>
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              placeholder="e.g., San Francisco, CA"
              onKeyPress={(e) => e.key === "Enter" && handleAddLocation()}
            />
            <Button variant="outline" onClick={handleAddLocation}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Remote Preference */}
        <div className="mb-6">
          <Label className="mb-2 block">Remote Preference</Label>
          <div className="flex flex-wrap gap-2">
            {["any", "remote", "hybrid", "onsite"].map((option) => (
              <button
                key={option}
                onClick={() => setRemotePreference(option)}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  remotePreference === option
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Salary Range */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="space-y-2">
            <Label htmlFor="salaryMin">Minimum Salary ($)</Label>
            <Input
              id="salaryMin"
              type="number"
              value={salaryMin}
              onChange={(e) => setSalaryMin(e.target.value)}
              placeholder="80000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="salaryMax">Maximum Salary ($)</Label>
            <Input
              id="salaryMax"
              type="number"
              value={salaryMax}
              onChange={(e) => setSalaryMax(e.target.value)}
              placeholder="150000"
            />
          </div>
        </div>

        <Button onClick={handleSavePreferences} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Preferences
        </Button>
      </div>
    </div>
  );
};

export default Settings;
