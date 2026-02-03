import { cn } from "@/lib/utils";
import { 
  Briefcase, 
  FileText, 
  Search, 
  Send, 
  Mail, 
  BarChart3, 
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  User,
  ShoppingCart
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const mainItems = [
  { icon: ShoppingCart, label: "Auto-Shop", path: "/auto-shop" },
  { icon: Settings, label: "Settings", path: "/dashboard/settings" },
];

const jobItems = [
  { icon: BarChart3, label: "Dashboard", path: "/dashboard" },
  { icon: FileText, label: "Resume", path: "/dashboard/resume" },
  { icon: Search, label: "Job Search", path: "/dashboard/jobs" },
  { icon: Send, label: "Applications", path: "/dashboard/applications" },
  { icon: Mail, label: "Inbox", path: "/dashboard/messages" },
];

export const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [jobsExpanded, setJobsExpanded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { profile } = useProfile();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const displayName = profile?.first_name 
    ? `${profile.first_name} ${profile.last_name || ''}`.trim()
    : profile?.email || 'User';

  return (
    <aside className={cn(
      "h-screen bg-card border-r border-border flex flex-col transition-all duration-300 relative",
      collapsed ? "w-20" : "w-64"
    )}>
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <Briefcase className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="font-bold text-lg text-foreground">AutoApply</span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        {/* Main Items */}
        <ul className="space-y-2 mb-4">
          {mainItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                    isActive 
                      ? "bg-primary text-primary-foreground shadow-md" 
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5 shrink-0" />
                  {!collapsed && <span className="font-medium">{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Job Features - Collapsible */}
        {!collapsed && (
          <Collapsible open={jobsExpanded} onOpenChange={setJobsExpanded}>
            <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
              <span className="flex items-center gap-2">
                <Briefcase className="w-4 h-4" />
                Job Tools
              </span>
              <ChevronDown className={cn(
                "w-4 h-4 transition-transform",
                jobsExpanded && "rotate-180"
              )} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="space-y-1 mt-2">
                {jobItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm",
                          isActive 
                            ? "bg-secondary text-foreground" 
                            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                        )}
                      >
                        <item.icon className="w-4 h-4 shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Collapsed view - just show icons for job items */}
        {collapsed && (
          <ul className="space-y-2 border-t border-border pt-4 mt-4">
            {jobItems.slice(0, 3).map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={cn(
                      "flex items-center justify-center p-2 rounded-lg transition-all duration-200",
                      isActive 
                        ? "bg-secondary text-foreground" 
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    )}
                    title={item.label}
                  >
                    <item.icon className="w-4 h-4" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* User section */}
      <div className="p-4 border-t border-border">
        <div className={cn(
          "flex items-center gap-3 mb-4",
          collapsed && "justify-center"
        )}>
          <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-muted-foreground" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
            </div>
          )}
        </div>
        
        {!collapsed && (
          <Button 
            variant="ghost" 
            className="w-full justify-start text-muted-foreground"
            onClick={handleSignOut}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center shadow-sm hover:bg-secondary transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
    </aside>
  );
};
