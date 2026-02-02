import { Upload, Settings, Rocket, Trophy, ArrowRight, CheckCircle2 } from "lucide-react";

const steps = [
  {
    step: "01",
    icon: Upload,
    title: "Upload Your Resume",
    description: "Upload any format — PDF, Word, or plain text. Our AI extracts and structures your experience, skills, and achievements.",
    details: [
      "Supports all major resume formats",
      "AI-powered content extraction",
      "Automatic skill identification",
      "Experience level detection",
    ],
    color: "primary",
  },
  {
    step: "02",
    icon: Settings,
    title: "Set Your Preferences",
    description: "Define your dream job criteria: titles, locations, salary range, remote options, company sizes, and industries you prefer.",
    details: [
      "Multiple job titles supported",
      "Salary range requirements",
      "Remote/hybrid preferences",
      "Company blacklist option",
    ],
    color: "accent",
  },
  {
    step: "03",
    icon: Rocket,
    title: "Activate Auto-Apply",
    description: "Turn on automation and watch the magic. Our AI agents find matching jobs, optimize your resume, and submit applications.",
    details: [
      "Daily application limits",
      "Active hours scheduling",
      "Custom cover letters per job",
      "ATS-optimized submissions",
    ],
    color: "success",
  },
  {
    step: "04",
    icon: Trophy,
    title: "Land Interviews",
    description: "Track all your applications, manage recruiter communications, and prepare for interviews — all in one dashboard.",
    details: [
      "Real-time status tracking",
      "AI response suggestions",
      "Interview prep materials",
      "Analytics & insights",
    ],
    color: "warning",
  },
];

const colorConfig = {
  primary: { bg: "bg-primary", bgLight: "bg-primary/10", text: "text-primary", gradient: "from-primary to-primary/50" },
  accent: { bg: "bg-accent", bgLight: "bg-accent/10", text: "text-accent", gradient: "from-accent to-accent/50" },
  success: { bg: "bg-success", bgLight: "bg-success/10", text: "text-success", gradient: "from-success to-success/50" },
  warning: { bg: "bg-warning", bgLight: "bg-warning/10", text: "text-warning", gradient: "from-warning to-warning/50" },
};

export const HowItWorksDetailed = () => {
  return (
    <section className="py-24 bg-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-1/2 left-0 w-[600px] h-[600px] bg-gradient-radial from-primary/5 to-transparent rounded-full -translate-y-1/2" />
      <div className="absolute top-1/2 right-0 w-[600px] h-[600px] bg-gradient-radial from-accent/5 to-transparent rounded-full -translate-y-1/2" />
      
      <div className="container px-4 relative z-10">
        {/* Section header */}
        <div className="max-w-3xl mx-auto text-center mb-20">
          <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-6">
            How AutoApply Works
          </h2>
          <p className="text-lg text-muted-foreground">
            Four simple steps to transform your job search from hours of work to complete automation
          </p>
        </div>

        {/* Steps */}
        <div className="max-w-6xl mx-auto space-y-12">
          {steps.map((step, index) => {
            const colors = colorConfig[step.color as keyof typeof colorConfig];
            const isEven = index % 2 === 0;
            
            return (
              <div 
                key={step.step} 
                className={`flex flex-col ${isEven ? 'lg:flex-row' : 'lg:flex-row-reverse'} items-center gap-8 lg:gap-16`}
              >
                {/* Visual side */}
                <div className="flex-1 w-full">
                  <div className={`glass-card rounded-3xl p-8 border border-border/50 relative overflow-hidden`}>
                    {/* Step number background */}
                    <div className={`absolute -top-4 -right-4 text-[120px] font-bold ${colors.text} opacity-5 leading-none`}>
                      {step.step}
                    </div>
                    
                    <div className="relative z-10">
                      {/* Icon */}
                      <div className={`w-20 h-20 rounded-2xl ${colors.bgLight} flex items-center justify-center mb-6`}>
                        <step.icon className={`w-10 h-10 ${colors.text}`} />
                      </div>
                      
                      {/* Step label */}
                      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${colors.bgLight} ${colors.text} text-sm font-medium mb-4`}>
                        Step {step.step}
                      </div>
                      
                      <h3 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
                        {step.title}
                      </h3>
                      <p className="text-muted-foreground text-lg leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Details side */}
                <div className="flex-1 w-full">
                  <div className="space-y-4">
                    {step.details.map((detail) => (
                      <div 
                        key={detail}
                        className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 transition-colors group"
                      >
                        <div className={`w-8 h-8 rounded-lg ${colors.bgLight} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                          <CheckCircle2 className={`w-5 h-5 ${colors.text}`} />
                        </div>
                        <span className="text-foreground font-medium">{detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Arrow to next step */}
                {index < steps.length - 1 && (
                  <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 mt-8">
                    <ArrowRight className="w-8 h-8 text-muted-foreground/30 rotate-90" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
