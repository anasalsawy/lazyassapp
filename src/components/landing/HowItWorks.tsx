import { Upload, Settings, Rocket, Trophy } from "lucide-react";

const steps = [
  {
    step: "01",
    icon: Upload,
    title: "Upload Your Resume",
    description: "Upload your existing resume or build one from scratch using our intuitive form.",
  },
  {
    step: "02",
    icon: Settings,
    title: "Set Preferences",
    description: "Tell us your ideal job titles, locations, salary range, and company preferences.",
  },
  {
    step: "03",
    icon: Rocket,
    title: "Activate Auto-Apply",
    description: "Our AI finds matching jobs, optimizes your resume, and applies automatically.",
  },
  {
    step: "04",
    icon: Trophy,
    title: "Land Interviews",
    description: "Track responses, manage communications, and prepare for your interviews.",
  },
];

export const HowItWorks = () => {
  return (
    <section className="py-24 bg-secondary/30">
      <div className="container px-4">
        {/* Section header */}
        <div className="max-w-2xl mx-auto text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            How It Works
          </h2>
          <p className="text-muted-foreground text-lg">
            Get from upload to interviews in four simple steps
          </p>
        </div>

        {/* Steps */}
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8">
            {steps.map((step, index) => (
              <div key={step.step} className="relative">
                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-10 left-1/2 w-full h-0.5 bg-gradient-to-r from-primary/50 to-primary/20" />
                )}
                
                <div className="relative text-center">
                  {/* Step number */}
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-card shadow-lg mb-6 relative z-10">
                    <step.icon className="w-8 h-8 text-primary" />
                    <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                      {step.step}
                    </span>
                  </div>
                  
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {step.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
