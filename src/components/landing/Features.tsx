import { 
  FileText, 
  Palette, 
  Search, 
  Send, 
  Mail, 
  BarChart3,
  Sparkles,
  Shield
} from "lucide-react";

const features = [
  {
    icon: FileText,
    title: "AI Resume Optimization",
    description: "Our AI analyzes your resume, adds relevant keywords, and tailors it for each job to beat ATS systems.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: Palette,
    title: "Professional Design",
    description: "Choose from modern, ATS-friendly templates. Customize colors, fonts, and layouts to stand out.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    icon: Search,
    title: "Smart Job Matching",
    description: "We scan thousands of job boards daily to find positions that match your skills and preferences.",
    color: "text-success",
    bg: "bg-success/10",
  },
  {
    icon: Send,
    title: "Auto-Apply Engine",
    description: "Automatically fill and submit applications with your optimized resume and personalized cover letters.",
    color: "text-warning",
    bg: "bg-warning/10",
  },
  {
    icon: Mail,
    title: "Communication Hub",
    description: "Manage all recruiter communications in one place. Get AI-suggested replies and never miss a response.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: BarChart3,
    title: "Analytics Dashboard",
    description: "Track application status, response rates, and optimize your strategy with data-driven insights.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
];

export const Features = () => {
  return (
    <section className="py-24 bg-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gradient-radial from-primary/5 to-transparent rounded-full" />
      
      <div className="container px-4 relative z-10">
        {/* Section header */}
        <div className="max-w-2xl mx-auto text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">Powerful Features</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Everything You Need to
            <span className="gradient-text"> Land Your Dream Job</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            From resume optimization to application tracking, we've got every step covered.
          </p>
        </div>

        {/* Features grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className="group glass-card rounded-2xl p-6 hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className={`w-12 h-12 rounded-xl ${feature.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                <feature.icon className={`w-6 h-6 ${feature.color}`} />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        {/* Trust badges */}
        <div className="mt-20 flex flex-wrap items-center justify-center gap-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Shield className="w-5 h-5 text-success" />
            <span className="text-sm">Bank-level Security</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="text-sm">🔒 GDPR Compliant</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="text-sm">⚡ 99.9% Uptime</span>
          </div>
        </div>
      </div>
    </section>
  );
};
