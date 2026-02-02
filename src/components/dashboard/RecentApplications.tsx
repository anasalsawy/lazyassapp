import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Clock } from "lucide-react";

const applications = [
  {
    id: 1,
    company: "Google",
    position: "Senior Frontend Developer",
    location: "Mountain View, CA",
    status: "Interview",
    statusColor: "bg-success/10 text-success",
    appliedAt: "2 hours ago",
  },
  {
    id: 2,
    company: "Meta",
    position: "React Engineer",
    location: "Menlo Park, CA",
    status: "Under Review",
    statusColor: "bg-warning/10 text-warning",
    appliedAt: "5 hours ago",
  },
  {
    id: 3,
    company: "Stripe",
    position: "Full Stack Developer",
    location: "San Francisco, CA",
    status: "Applied",
    statusColor: "bg-primary/10 text-primary",
    appliedAt: "1 day ago",
  },
  {
    id: 4,
    company: "Airbnb",
    position: "Software Engineer",
    location: "Remote",
    status: "Applied",
    statusColor: "bg-primary/10 text-primary",
    appliedAt: "2 days ago",
  },
];

export const RecentApplications = () => {
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Recent Applications</h2>
        <a href="/dashboard/applications" className="text-sm text-primary hover:underline">
          View all
        </a>
      </div>

      <div className="space-y-4">
        {applications.map((app) => (
          <div
            key={app.id}
            className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-card flex items-center justify-center shadow-sm">
                <Building2 className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">{app.position}</h3>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm text-muted-foreground">{app.company}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="w-3 h-3" />
                    {app.location}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {app.appliedAt}
              </span>
              <Badge className={app.statusColor} variant="secondary">
                {app.status}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
