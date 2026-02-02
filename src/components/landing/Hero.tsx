import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Zap, Target } from "lucide-react";
import { Link } from "react-router-dom";

export const Hero = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden hero-gradient">
      {/* Background effects */}
      <div className="absolute inset-0 bg-hero-pattern opacity-30" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/20 rounded-full blur-3xl animate-float" style={{ animationDelay: "-3s" }} />
      
      <div className="container relative z-10 px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card/10 backdrop-blur-sm border border-card/20 text-card mb-8 animate-fade-in">
            <Sparkles className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium">AI-Powered Job Automation</span>
          </div>

          {/* Main heading */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-card mb-6 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            Land Your Dream Job
            <span className="block mt-2 gradient-text">On Autopilot</span>
          </h1>

          {/* Subheading */}
          <p className="text-lg md:text-xl text-card/70 max-w-2xl mx-auto mb-10 animate-slide-up" style={{ animationDelay: "0.2s" }}>
            Upload your resume, set your preferences, and let AI handle the rest. 
            We optimize, design, search, and apply—while you focus on what matters.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 animate-slide-up" style={{ animationDelay: "0.3s" }}>
            <Link to="/dashboard">
              <Button variant="hero" size="xl" className="group">
                Get Started Free
                <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Button variant="glass" size="xl">
              Watch Demo
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: "0.5s" }}>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-card mb-1">70%</div>
              <div className="text-sm text-card/60">Time Saved</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-card mb-1">3x</div>
              <div className="text-sm text-card/60">More Interviews</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-card mb-1">10K+</div>
              <div className="text-sm text-card/60">Jobs Applied</div>
            </div>
          </div>
        </div>

        {/* Feature cards floating */}
        <div className="hidden lg:block">
          <div className="absolute top-1/3 left-8 glass-card p-4 rounded-xl animate-float" style={{ animationDelay: "-1s" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-sm font-medium text-card">Auto-Apply</div>
                <div className="text-xs text-card/60">50+ jobs/day</div>
              </div>
            </div>
          </div>

          <div className="absolute top-1/2 right-8 glass-card p-4 rounded-xl animate-float" style={{ animationDelay: "-2s" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                <Target className="w-5 h-5 text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-card">ATS Optimized</div>
                <div className="text-xs text-card/60">95% pass rate</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
};
