import { StatsCard } from "@/components/dashboard/StatsCard";
import { RecentApplications } from "@/components/dashboard/RecentApplications";
import { JobMatches } from "@/components/dashboard/JobMatches";
import { ResumeUpload } from "@/components/dashboard/ResumeUpload";
import { Send, Eye, MessageSquare, Calendar, Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProfile } from "@/hooks/useProfile";
import { useApplications } from "@/hooks/useApplications";
import { Link } from "react-router-dom";

const Dashboard = () => {
  const { profile } = useProfile();
  const { stats } = useApplications();

  const firstName = profile?.first_name || "there";

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
            Welcome back, {firstName}! 👋
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's what's happening with your job search today.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search jobs..." 
              className="pl-10 w-64"
            />
          </div>
          <Button variant="outline" size="icon">
            <Bell className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard
          title="Applications Sent"
          value={stats.total}
          change={stats.total > 0 ? `${stats.applied} pending` : undefined}
          changeType="neutral"
          icon={Send}
          iconColor="text-primary"
          iconBg="bg-primary/10"
        />
        <StatsCard
          title="Under Review"
          value={stats.underReview}
          change={stats.underReview > 0 ? "In progress" : undefined}
          changeType="positive"
          icon={Eye}
          iconColor="text-accent"
          iconBg="bg-accent/10"
        />
        <StatsCard
          title="Interviews"
          value={stats.interviews}
          change={stats.interviews > 0 ? "Great progress!" : undefined}
          changeType="positive"
          icon={Calendar}
          iconColor="text-success"
          iconBg="bg-success/10"
        />
        <StatsCard
          title="Offers"
          value={stats.offers}
          change={stats.offers > 0 ? "Congratulations!" : undefined}
          changeType="positive"
          icon={MessageSquare}
          iconColor="text-warning"
          iconBg="bg-warning/10"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column - Resume & Applications */}
        <div className="lg:col-span-2 space-y-6">
          <RecentApplications />
          <JobMatches />
        </div>

        {/* Right Column - Resume Upload */}
        <div className="space-y-6">
          <ResumeUpload />
          
          {/* Quick Actions */}
          <div className="glass-card rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <Link to="/dashboard/jobs">
                <Button variant="outline" className="w-full justify-start">
                  <Search className="w-4 h-4 mr-2" />
                  Browse Jobs
                </Button>
              </Link>
              <Link to="/dashboard/applications">
                <Button variant="outline" className="w-full justify-start">
                  <Send className="w-4 h-4 mr-2" />
                  View Applications
                </Button>
              </Link>
              <Link to="/dashboard/settings">
                <Button variant="outline" className="w-full justify-start">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Update Preferences
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
