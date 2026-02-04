import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Clock } from "lucide-react";
import { useApplications } from "@/hooks/useApplications";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";

const statusColors: Record<string, string> = {
  "pending-apply": "bg-muted text-muted-foreground",
  "applying": "bg-primary/10 text-primary",
  "applied": "bg-blue-500/10 text-blue-600",
  "in-review": "bg-purple-500/10 text-purple-600",
  "interview": "bg-success/10 text-success",
  "offer": "bg-yellow-500/10 text-yellow-600",
  "rejected": "bg-destructive/10 text-destructive",
  "error": "bg-destructive/10 text-destructive",
  "needs-user-action": "bg-warning/10 text-warning",
};

const statusLabels: Record<string, string> = {
  "pending-apply": "Pending",
  "applying": "Applying",
  "applied": "Applied",
  "in-review": "In Review",
  "interview": "Interview",
  "offer": "Offer",
  "rejected": "Rejected",
  "error": "Error",
  "needs-user-action": "Action Needed",
};

export const RecentApplications = () => {
  const { applications, loading } = useApplications();
  const recentApplications = applications.slice(0, 5);

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-secondary rounded w-1/3" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-secondary rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Recent Applications</h2>
        <Link to="/dashboard/applications" className="text-sm text-primary hover:underline">
          View all
        </Link>
      </div>

      {recentApplications.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No applications yet. Start applying to jobs!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recentApplications.map((app) => (
            <div
              key={app.id}
              className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-card flex items-center justify-center shadow-sm">
                  <Building2 className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">{app.job?.title || "Unknown Position"}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-sm text-muted-foreground">{app.job?.company || "Unknown Company"}</span>
                    {app.job?.location && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        {app.job.location}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(app.applied_at), { addSuffix: true })}
                </span>
                <Badge className={statusColors[app.status]} variant="secondary">
                  {statusLabels[app.status]}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
