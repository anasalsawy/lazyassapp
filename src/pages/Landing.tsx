import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { 
  Upload, 
  LogIn, 
  Bot, 
  ArrowRight, 
  CheckCircle2, 
  Shield, 
  Zap,
  Mail,
  Briefcase,
  FileText,
  Clock,
  Sparkles,
  Target,
  Send,
  BarChart3,
  ChevronRight,
  Star
} from "lucide-react";
import { FAQ } from "@/components/landing/FAQ";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/60 backdrop-blur-2xl border-b border-border/40">
        <div className="container max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center glow">
              <Bot className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display font-bold text-xl">Career Compass</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
            <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link to="/auth?signup=true">
              <Button size="sm" className="gap-2 rounded-full px-5">
                Get Started
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-24 px-4 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 mesh-bg" />
        <div className="absolute top-20 left-1/4 w-[500px] h-[500px] bg-primary/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-accent/6 rounded-full blur-[100px]" />
        <div className="absolute inset-0 dot-pattern opacity-40" />
        
        <div className="container max-w-6xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/8 border border-primary/15 text-primary mb-8 animate-fade-in">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">AI-Powered Job Automation</span>
            <ChevronRight className="w-3 h-3" />
          </div>
          
          <h1 className="text-5xl md:text-7xl font-display font-bold mb-6 tracking-tight leading-[1.1] animate-slide-up">
            Upload once.
            <br />
            <span className="gradient-text">Let AI hunt for you.</span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            Stop spending hours on job applications. Our AI agent searches, applies, 
            and tracks responses—automatically, around the clock.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-20 animate-slide-up" style={{ animationDelay: "0.2s" }}>
            <Link to="/auth?signup=true">
              <Button size="lg" className="text-lg px-8 gap-2 rounded-full h-14 glow">
                Start Free <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="text-lg px-8 rounded-full h-14">
              Watch Demo
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-6 max-w-lg mx-auto animate-fade-in" style={{ animationDelay: "0.4s" }}>
            {[
              { value: "500+", label: "Jobs Applied Daily" },
              { value: "85%", label: "Time Saved" },
              { value: "24/7", label: "Always Running" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-display font-bold gradient-text mb-1">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 px-4 relative">
        <div className="absolute inset-0 grid-pattern opacity-50" />
        <div className="container max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 px-4 py-1.5 rounded-full">How It Works</Badge>
            <h2 className="text-3xl md:text-5xl font-display font-bold mb-4">Three steps to <span className="gradient-text">autopilot</span></h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">Set it up once. The agent handles the rest.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Upload, step: "01", title: "Upload Resume", desc: "Upload your existing resume. Our AI optimizes it for ATS systems and creates polished versions.", color: "from-primary/20 to-primary/5" },
              { icon: LogIn, step: "02", title: "Connect Accounts", desc: "Log into your email and job sites once. We securely save sessions—no passwords stored.", color: "from-accent/20 to-accent/5" },
              { icon: Bot, step: "03", title: "Agent Takes Over", desc: "Sit back while our AI searches for jobs, applies automatically, and monitors responses.", color: "from-success/20 to-success/5" },
            ].map((item) => (
              <div key={item.step} className="group relative">
                <div className="feature-card h-full">
                  <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${item.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                        <item.icon className="w-7 h-7 text-primary" />
                      </div>
                      <span className="text-5xl font-display font-bold text-muted/60">{item.step}</span>
                    </div>
                    <h3 className="text-xl font-display font-semibold mb-3">{item.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-4 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-primary/5 to-transparent rounded-full" />
        
        <div className="container max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 px-4 py-1.5 rounded-full">
              <Zap className="w-3 h-3 mr-1" /> Features
            </Badge>
            <h2 className="text-3xl md:text-5xl font-display font-bold mb-4">
              Everything <span className="gradient-text">automated</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              From resume optimization to interview scheduling
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: FileText, title: "AI Resume Optimization", desc: "ATS-friendly keywords, impact verbs, and professional formatting—automatically.", accent: "primary" },
              { icon: Target, title: "Smart Job Matching", desc: "Scans thousands of job boards daily to find positions matching your skills.", accent: "accent" },
              { icon: Send, title: "Auto-Apply Engine", desc: "Submits applications with customized cover letters and optimized answers.", accent: "success" },
              { icon: Mail, title: "Email Monitoring", desc: "Tracks recruiter responses, interview invites, and follows up on your behalf.", accent: "primary" },
              { icon: Clock, title: "24/7 Operation", desc: "Runs continuously, applying to new jobs as soon as they're posted.", accent: "accent" },
              { icon: Shield, title: "Secure & Private", desc: "No passwords stored. Sessions encrypted. Revoke access anytime.", accent: "success" },
            ].map((feature) => (
              <div key={feature.title} className="feature-card group">
                <div className={`w-12 h-12 rounded-xl bg-${feature.accent}/10 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300`}>
                  <feature.icon className={`w-6 h-6 text-${feature.accent}`} />
                </div>
                <h3 className="font-display font-semibold text-lg mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo / Visualization Section */}
      <section className="py-24 px-4 relative">
        <div className="absolute inset-0 dot-pattern opacity-30" />
        <div className="container max-w-5xl mx-auto relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-display font-bold mb-4">See it in <span className="gradient-text-accent">action</span></h2>
            <p className="text-muted-foreground text-lg">Watch the agent work through the pipeline</p>
          </div>

          <div className="relative rounded-3xl border border-border/50 bg-card overflow-hidden p-1">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 bg-secondary/50 rounded-t-2xl border-b border-border/30">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-destructive/50" />
                <div className="w-3 h-3 rounded-full bg-warning/50" />
                <div className="w-3 h-3 rounded-full bg-success/50" />
              </div>
              <div className="flex-1 mx-4">
                <div className="bg-background/60 rounded-lg px-4 py-1.5 text-xs text-muted-foreground text-center">
                  career-compass.ai/pipeline
                </div>
              </div>
            </div>
            
            {/* Pipeline visualization */}
            <div className="p-8 md:p-12 bg-gradient-to-br from-card to-secondary/20">
              <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                {[
                  { icon: Sparkles, label: "Resume Optimized", sublabel: "ATS Score: 94%", color: "primary" },
                  { icon: Bot, label: "Agent Searching", sublabel: "127 matches found", color: "primary", active: true },
                  { icon: Send, label: "Applications Sent", sublabel: "23 submitted today", color: "success" },
                  { icon: Mail, label: "Interviews!", sublabel: "3 responses received", color: "accent" },
                ].map((step, i) => (
                  <div key={step.label} className="flex items-center gap-4 md:flex-col md:gap-3 flex-1">
                    <div className={`relative w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center ${
                      step.active 
                        ? "bg-primary text-primary-foreground shadow-xl shadow-primary/30 animate-pulse-glow" 
                        : `bg-${step.color}/10`
                    }`}>
                      <step.icon className={`w-8 h-8 md:w-10 md:h-10 ${step.active ? "" : `text-${step.color}`}`} />
                      {step.active && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-success rounded-full border-2 border-card" />
                      )}
                    </div>
                    <div className="md:text-center">
                      <div className="font-display font-semibold text-sm">{step.label}</div>
                      <div className="text-xs text-muted-foreground">{step.sublabel}</div>
                    </div>
                    {i < 3 && (
                      <div className="hidden md:block">
                        <div className="w-12 h-0.5 bg-gradient-to-r from-primary/40 to-transparent rounded-full" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Mini stats below */}
          <div className="grid grid-cols-3 gap-4 mt-8">
            {[
              { value: "24/7", label: "Always Running" },
              { value: "50+", label: "Daily Applications" },
              { value: "100%", label: "Logged & Tracked" },
            ].map((s) => (
              <div key={s.label} className="stat-card text-center">
                <div className="text-2xl font-display font-bold gradient-text">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-24 px-4 relative overflow-hidden">
        <div className="absolute inset-0 grid-pattern opacity-40" />
        <div className="container max-w-4xl mx-auto relative z-10">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Your privacy, <span className="gradient-text">protected</span></h2>
            <p className="text-muted-foreground text-lg">Built with security-first principles</p>
          </div>

          <div className="space-y-3">
            {[
              "We never store your passwords—only secure session tokens",
              "All data is encrypted at rest and in transit",
              "You can revoke access to any connected account anytime",
              "Your resume and personal data are never shared",
              "Complete activity logs so you know exactly what the agent did",
            ].map((text) => (
              <div key={text} className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border/40 hover:border-success/30 transition-colors">
                <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                </div>
                <span className="text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <div id="faq">
        <FAQ />
      </div>

      {/* CTA */}
      <section className="py-24 px-4 relative overflow-hidden">
        <div className="absolute inset-0 mesh-bg" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[150px]" />
        <div className="container max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-1 mb-6">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="w-5 h-5 fill-accent text-accent" />
            ))}
          </div>
          <h2 className="text-3xl md:text-5xl font-display font-bold mb-6">
            Ready to automate your job search?
          </h2>
          <p className="text-xl text-muted-foreground mb-10 max-w-xl mx-auto">
            Join thousands of job seekers who let AI do the heavy lifting.
          </p>
          <Link to="/auth?signup=true">
            <Button size="lg" className="text-lg px-10 gap-2 rounded-full h-14 glow">
              Get Started Free <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8 px-4">
        <div className="container max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-display font-semibold">Career Compass</span>
          </div>
          <div className="text-sm text-muted-foreground">
            © 2025 Career Compass. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
