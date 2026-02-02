import { StatsCard } from "@/components/dashboard/StatsCard";
import { RecentApplications } from "@/components/dashboard/RecentApplications";
import { JobMatches } from "@/components/dashboard/JobMatches";
import { ResumeUpload } from "@/components/dashboard/ResumeUpload";
import { Send, Eye, MessageSquare, Calendar, Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Dashboard = () => {
  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
            Welcome back, John! 👋
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
          value={127}
          change="+12 today"
          changeType="positive"
          icon={Send}
          iconColor="text-primary"
          iconBg="bg-primary/10"
        />
        <StatsCard
          title="Profile Views"
          value={89}
          change="+23%"
          changeType="positive"
          icon={Eye}
          iconColor="text-accent"
          iconBg="bg-accent/10"
        />
        <StatsCard
          title="Responses"
          value={34}
          change="27% rate"
          changeType="neutral"
          icon={MessageSquare}
          iconColor="text-success"
          iconBg="bg-success/10"
        />
        <StatsCard
          title="Interviews"
          value={8}
          change="3 this week"
          changeType="positive"
          icon={Calendar}
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
              <Button variant="outline" className="w-full justify-start">
                <Send className="w-4 h-4 mr-2" />
                Start Auto-Apply
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <Search className="w-4 h-4 mr-2" />
                Browse Jobs
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <MessageSquare className="w-4 h-4 mr-2" />
                Check Messages
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
