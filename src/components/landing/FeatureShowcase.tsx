import { 
  FileText, 
  Palette, 
  Search, 
  Send, 
  Mail, 
  BarChart3,
  Bot,
  Zap,
  Target,
  Shield,
  Clock,
  CheckCircle2,
  Sparkles
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    icon: Bot,
    title: "Multi-Agent AI System",
    description: "5 specialized AI agents work in parallel: Resume Optimizer, Job Matcher, Application Submitter, Email Manager, and Analytics Engine.",
    status: "live",
    color: "primary",
  },
  {
    icon: FileText,
    title: "AI Resume Optimization",
    description: "Upload any resume format. Our AI extracts content, adds relevant keywords, and tailors it for each job to beat ATS systems.",
    status: "live",
    color: "primary",
  },
  {
    icon: Palette,
    title: "Professional Redesign",
    description: "Choose from 12+ modern, ATS-friendly templates. AI automatically redesigns your resume with perfect formatting and typography.",
    status: "live",
    color: "accent",
  },
  {
    icon: Search,
    title: "Smart Job Matching",
    description: "Scans LinkedIn, Indeed, Glassdoor & more. AI scores each job based on your skills, preferences, and salary requirements.",
    status: "live",
    color: "success",
  },
  {
    icon: Send,
    title: "Auto-Apply Engine",
    description: "Set daily limits and preferences. Our bot fills applications, generates custom cover letters, and submits automatically.",
    status: "live",
    color: "warning",
  },
  {
    icon: Mail,
    title: "Communication Hub",
    description: "Unified inbox for all recruiter communications. AI analyzes sentiment, suggests replies, and tracks conversation threads.",
    status: "live",
    color: "primary",
  },
  {
    icon: BarChart3,
    title: "Analytics Dashboard",
    description: "Track response rates, interview conversion, and optimize your strategy with AI-powered insights and recommendations.",
    status: "live",
    color: "accent",
  },
  {
    icon: Clock,
    title: "Scheduled Automation",
    description: "Set active hours for applications. Define blackout periods. Control exactly when and how the system works for you.",
    status: "coming",
    color: "muted",
  },
  {
    icon: Target,
    title: "Interview Prep",
    description: "AI generates company-specific interview questions. Practice with our mock interview system and get feedback.",
    status: "coming",
    color: "muted",
  },
];

const statusConfig = {
  live: { label: "Ready", variant: "default" as const, className: "bg-success/20 text-success border-success/30" },
  beta: { label: "Beta", variant: "secondary" as const, className: "bg-warning/20 text-warning border-warning/30" },
  coming: { label: "Coming Soon", variant: "outline" as const, className: "bg-muted text-muted-foreground border-muted" },
};

const colorConfig = {
  primary: { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" },
  accent: { bg: "bg-accent/10", text: "text-accent", border: "border-accent/20" },
  success: { bg: "bg-success/10", text: "text-success", border: "border-success/20" },
  warning: { bg: "bg-warning/10", text: "text-warning", border: "border-warning/20" },
  muted: { bg: "bg-muted", text: "text-muted-foreground", border: "border-muted" },
};

export const FeatureShowcase = () => {
  return (
    <section className="py-24 bg-secondary/30 relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 bg-hero-pattern opacity-50" />
      
      <div className="container px-4 relative z-10">
        {/* Section header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">Full Feature Suite</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-6">
            Everything You Need to
            <span className="gradient-text block mt-2">Automate Your Job Hunt</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            A complete end-to-end platform powered by AI agents that handle every step of the job search process
          </p>
        </div>

        {/* Features grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {features.map((feature, index) => {
            const colors = colorConfig[feature.color as keyof typeof colorConfig];
            const status = statusConfig[feature.status as keyof typeof statusConfig];
            
            return (
              <div
                key={feature.title}
                className={`group glass-card rounded-2xl p-6 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 border ${colors.border} ${feature.status === 'coming' ? 'opacity-75' : ''}`}
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-14 h-14 rounded-2xl ${colors.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <feature.icon className={`w-7 h-7 ${colors.text}`} />
                  </div>
                  <Badge variant={status.variant} className={status.className}>
                    {status.label}
                  </Badge>
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Trust section */}
        <div className="mt-20 max-w-4xl mx-auto">
          <div className="glass-card rounded-2xl p-8 border border-border/50">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center">
                  <Shield className="w-8 h-8 text-success" />
                </div>
                <div>
                  <h4 className="text-xl font-semibold text-foreground">Enterprise-Grade Security</h4>
                  <p className="text-muted-foreground">Your data is encrypted and never shared</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  <span className="text-sm">SOC 2 Compliant</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  <span className="text-sm">GDPR Ready</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  <span className="text-sm">256-bit Encryption</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
