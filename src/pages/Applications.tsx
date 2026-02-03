import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApplications } from "@/hooks/useApplications";
import { Building2, MapPin, Clock, MoreVertical, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-muted animate-pulse",
  in_progress: "bg-primary/10 text-primary border-primary/20 animate-pulse",
  applied: "bg-success/10 text-success border-success/20",
  under_review: "bg-warning/10 text-warning border-warning/20",
  interview: "bg-accent/10 text-accent border-accent/20",
  offer: "bg-primary/10 text-primary border-primary/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  withdrawn: "bg-muted text-muted-foreground border-muted",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  in_progress: "AI Submitting...",
  applied: "Applied",
  under_review: "Under Review",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  failed: "Failed",
};

const statuses = ["pending", "in_progress", "applied", "under_review", "interview", "offer", "rejected", "withdrawn", "failed"];

const Applications = () => {
  const { applications, loading, stats, updateStatus, deleteApplication } = useApplications();

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-secondary rounded w-1/3 mb-8" />
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-secondary rounded-xl" />
            ))}
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-secondary rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Applications</h1>
        <p className="text-muted-foreground mt-1">
          Track and manage your job applications
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div className="glass-card rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-foreground">{stats.total}</div>
          <div className="text-xs text-muted-foreground">Total</div>
        </div>
        <div className="glass-card rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-primary">{stats.applied}</div>
          <div className="text-xs text-muted-foreground">Applied</div>
        </div>
        <div className="glass-card rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-warning">{stats.underReview}</div>
          <div className="text-xs text-muted-foreground">Reviewing</div>
        </div>
        <div className="glass-card rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-success">{stats.interviews}</div>
          <div className="text-xs text-muted-foreground">Interviews</div>
        </div>
        <div className="glass-card rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-accent">{stats.offers}</div>
          <div className="text-xs text-muted-foreground">Offers</div>
        </div>
        <div className="glass-card rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-destructive">{stats.rejected}</div>
          <div className="text-xs text-muted-foreground">Rejected</div>
        </div>
      </div>

      {/* Applications List */}
      {applications.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <p className="text-muted-foreground mb-4">No applications yet. Start applying to jobs!</p>
          <Button asChild>
            <a href="/dashboard/jobs">Browse Jobs</a>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <div
              key={app.id}
              className="glass-card rounded-2xl p-6 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                    <Building2 className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {app.job?.title || "Unknown Position"}
                    </h3>
                    <p className="text-muted-foreground">{app.job?.company || "Unknown Company"}</p>
                    <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                      {app.job?.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {app.job.location}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        Applied {formatDistanceToNow(new Date(app.applied_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Status Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className={`${statusColors[app.status]} border`}>
                        {statusLabels[app.status]}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {statuses.map((status) => (
                        <DropdownMenuItem
                          key={status}
                          onClick={() => updateStatus(app.id, status)}
                          className={app.status === status ? "bg-secondary" : ""}
                        >
                          <Badge className={`${statusColors[status]} mr-2`} variant="outline">
                            {statusLabels[status]}
                          </Badge>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Actions Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem 
                        onClick={() => deleteApplication(app.id)}
                        className="text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {app.notes && (
                <div className="mt-4 p-3 bg-secondary/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">{app.notes}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Applications;
