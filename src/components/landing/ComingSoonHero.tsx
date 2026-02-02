import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Sparkles, Zap, Target, Bot, Rocket, Clock } from "lucide-react";
import { useState } from "react";

export const ComingSoonHero = () => {
  const [email, setEmail] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setIsSubmitted(true);
      setEmail("");
    }
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden hero-gradient pt-20">
      {/* Animated background effects */}
      <div className="absolute inset-0 bg-hero-pattern opacity-30" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/20 rounded-full blur-3xl animate-float" style={{ animationDelay: "-3s" }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-3xl" />
      
      {/* Grid overlay */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)`,
        backgroundSize: '60px 60px'
      }} />
      
      <div className="container relative z-10 px-4 py-20">
        <div className="max-w-5xl mx-auto text-center">
          {/* Coming Soon Badge */}
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-primary/20 backdrop-blur-sm border border-primary/30 mb-8 animate-fade-in">
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-accent"></span>
            </div>
            <span className="text-sm font-semibold text-primary-foreground tracking-wide uppercase">Coming Soon</span>
            <Clock className="w-4 h-4 text-accent" />
          </div>

          {/* Main heading */}
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold text-primary-foreground mb-6 animate-slide-up leading-tight">
            The Future of
            <span className="block mt-2 gradient-text bg-gradient-to-r from-primary via-accent to-success bg-clip-text text-transparent">Job Hunting</span>
          </h1>

          {/* Subheading */}
          <p className="text-xl md:text-2xl text-primary-foreground/70 max-w-3xl mx-auto mb-12 animate-slide-up leading-relaxed" style={{ animationDelay: "0.1s" }}>
            Meet <span className="font-semibold text-accent">AutoApply</span> — the AI-powered platform that optimizes your resume, 
            finds perfect job matches, and applies automatically while you focus on what matters.
          </p>

          {/* Waitlist Form */}
          <div className="max-w-md mx-auto mb-16 animate-slide-up" style={{ animationDelay: "0.2s" }}>
            {!isSubmitted ? (
              <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
                <Input
                  type="email"
                  placeholder="Enter your email for early access"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-14 px-6 bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground placeholder:text-primary-foreground/50 rounded-xl text-lg"
                  required
                />
                <Button type="submit" variant="hero" size="xl" className="group whitespace-nowrap">
                  Join Waitlist
                  <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                </Button>
              </form>
            ) : (
              <div className="glass-card p-6 rounded-2xl border border-success/30 bg-success/10">
                <div className="flex items-center justify-center gap-3 text-success">
                  <Sparkles className="w-6 h-6" />
                  <span className="text-lg font-semibold">You're on the list! We'll notify you at launch.</span>
                </div>
              </div>
            )}
            <p className="text-sm text-primary-foreground/50 mt-4">
              Join 2,500+ job seekers already on the waitlist
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto animate-fade-in" style={{ animationDelay: "0.4s" }}>
            <div className="glass-card p-6 rounded-2xl border border-primary-foreground/10">
              <div className="text-3xl md:text-4xl font-bold text-primary-foreground mb-1">50+</div>
              <div className="text-sm text-primary-foreground/60">Jobs/Day</div>
            </div>
            <div className="glass-card p-6 rounded-2xl border border-primary-foreground/10">
              <div className="text-3xl md:text-4xl font-bold text-accent mb-1">95%</div>
              <div className="text-sm text-primary-foreground/60">ATS Pass Rate</div>
            </div>
            <div className="glass-card p-6 rounded-2xl border border-primary-foreground/10">
              <div className="text-3xl md:text-4xl font-bold text-primary-foreground mb-1">3x</div>
              <div className="text-sm text-primary-foreground/60">More Interviews</div>
            </div>
            <div className="glass-card p-6 rounded-2xl border border-primary-foreground/10">
              <div className="text-3xl md:text-4xl font-bold text-success mb-1">70%</div>
              <div className="text-sm text-primary-foreground/60">Time Saved</div>
            </div>
          </div>
        </div>

        {/* Floating feature cards */}
        <div className="hidden lg:block">
          <div className="absolute top-1/4 left-8 glass-card p-4 rounded-xl animate-float border border-primary-foreground/10" style={{ animationDelay: "-1s" }}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/30 flex items-center justify-center">
                <Bot className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <div className="text-sm font-semibold text-primary-foreground">AI Agents</div>
                <div className="text-xs text-primary-foreground/60">5 specialized bots</div>
              </div>
            </div>
          </div>

          <div className="absolute top-1/3 right-8 glass-card p-4 rounded-xl animate-float border border-primary-foreground/10" style={{ animationDelay: "-2s" }}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-accent/30 flex items-center justify-center">
                <Zap className="w-6 h-6 text-accent" />
              </div>
              <div>
                <div className="text-sm font-semibold text-primary-foreground">Auto-Apply</div>
                <div className="text-xs text-primary-foreground/60">Set it & forget it</div>
              </div>
            </div>
          </div>

          <div className="absolute bottom-1/3 left-12 glass-card p-4 rounded-xl animate-float border border-primary-foreground/10" style={{ animationDelay: "-4s" }}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-success/30 flex items-center justify-center">
                <Target className="w-6 h-6 text-success" />
              </div>
              <div>
                <div className="text-sm font-semibold text-primary-foreground">Smart Match</div>
                <div className="text-xs text-primary-foreground/60">AI job scoring</div>
              </div>
            </div>
          </div>

          <div className="absolute bottom-1/4 right-12 glass-card p-4 rounded-xl animate-float border border-primary-foreground/10" style={{ animationDelay: "-5s" }}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-warning/30 flex items-center justify-center">
                <Rocket className="w-6 h-6 text-warning" />
              </div>
              <div>
                <div className="text-sm font-semibold text-primary-foreground">Launch Ready</div>
                <div className="text-xs text-primary-foreground/60">Q1 2026</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-background to-transparent" />
      
      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <div className="w-8 h-12 rounded-full border-2 border-primary-foreground/30 flex items-start justify-center p-2">
          <div className="w-1.5 h-3 bg-primary-foreground/50 rounded-full animate-pulse" />
        </div>
      </div>
    </section>
  );
};
