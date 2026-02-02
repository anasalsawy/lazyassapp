import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, DollarSign, Sparkles } from "lucide-react";

const jobs = [
  {
    id: 1,
    company: "Netflix",
    position: "Senior React Developer",
    location: "Los Gatos, CA",
    salary: "$180k - $220k",
    matchScore: 95,
    skills: ["React", "TypeScript", "Node.js"],
    postedAt: "Just now",
  },
  {
    id: 2,
    company: "Spotify",
    position: "Frontend Engineer",
    location: "Remote",
    salary: "$150k - $190k",
    matchScore: 92,
    skills: ["React", "GraphQL", "AWS"],
    postedAt: "2 hours ago",
  },
  {
    id: 3,
    company: "Shopify",
    position: "Staff Engineer",
    location: "Remote",
    salary: "$200k - $250k",
    matchScore: 88,
    skills: ["React", "Ruby", "PostgreSQL"],
    postedAt: "5 hours ago",
  },
];

export const JobMatches = () => {
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">Top Job Matches</h2>
          <Sparkles className="w-4 h-4 text-accent" />
        </div>
        <a href="/dashboard/jobs" className="text-sm text-primary hover:underline">
          View all
        </a>
      </div>

      <div className="space-y-4">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="p-4 rounded-xl border border-border hover:border-primary/50 hover:shadow-md transition-all duration-200"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">{job.position}</h3>
                  <p className="text-sm text-muted-foreground">{job.company}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-success/10">
                <span className="text-xs font-bold text-success">{job.matchScore}%</span>
                <span className="text-xs text-success">match</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 mb-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                {job.location}
              </span>
              <span className="flex items-center gap-1">
                <DollarSign className="w-4 h-4" />
                {job.salary}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {job.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs">
                    {skill}
                  </Badge>
                ))}
              </div>
              <Button size="sm">Quick Apply</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
