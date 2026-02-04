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
  Clock
} from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="container max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl">Career Compass</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/auth">
              <Button variant="ghost">Log in</Button>
            </Link>
            <Link to="/auth?signup=true">
              <Button className="gap-2">
                Get Started
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="container max-w-6xl mx-auto text-center">
          <Badge variant="secondary" className="mb-6 px-4 py-2">
            <Zap className="w-4 h-4 mr-2" />
            AI-Powered Job Automation
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight">
            Upload your resume once.
            <br />
            <span className="gradient-text">Let the agent hunt for you.</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Stop spending hours on job applications. Our AI agent searches, applies, 
            and tracks responses for you—automatically, around the clock.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link to="/auth?signup=true">
              <Button size="lg" className="text-lg px-8 gap-2">
                Start Free <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="text-lg px-8">
              Watch Demo
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-8 max-w-xl mx-auto">
            <div>
              <div className="text-3xl font-bold text-primary">500+</div>
              <div className="text-sm text-muted-foreground">Jobs Applied Daily</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">85%</div>
              <div className="text-sm text-muted-foreground">Time Saved</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">24/7</div>
              <div className="text-sm text-muted-foreground">Always Running</div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 bg-secondary/30">
        <div className="container max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground text-lg">Three simple steps to automated job hunting</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="glass-card rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <div className="text-sm font-medium text-primary mb-2">Step 1</div>
              <h3 className="text-xl font-semibold mb-3">Upload Resume</h3>
              <p className="text-muted-foreground">
                Upload your existing resume. Our AI optimizes it for ATS systems 
                and creates polished versions for different job types.
              </p>
            </div>

            {/* Step 2 */}
            <div className="glass-card rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <LogIn className="w-8 h-8 text-primary" />
              </div>
              <div className="text-sm font-medium text-primary mb-2">Step 2</div>
              <h3 className="text-xl font-semibold mb-3">Connect Accounts</h3>
              <p className="text-muted-foreground">
                Log into your email and job sites once. We securely save your 
                sessions—no passwords stored, ever.
              </p>
            </div>

            {/* Step 3 */}
            <div className="glass-card rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Bot className="w-8 h-8 text-primary" />
              </div>
              <div className="text-sm font-medium text-primary mb-2">Step 3</div>
              <h3 className="text-xl font-semibold mb-3">Agent Takes Over</h3>
              <p className="text-muted-foreground">
                Sit back while our AI searches for jobs, applies automatically, 
                and monitors your email for responses.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4">
        <div className="container max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything Automated</h2>
            <p className="text-muted-foreground text-lg">From resume optimization to interview scheduling</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <FeatureCard 
              icon={FileText}
              title="AI Resume Optimization"
              description="Your resume is analyzed and rewritten with ATS-friendly keywords, impact verbs, and professional formatting."
            />
            <FeatureCard 
              icon={Briefcase}
              title="Smart Job Matching"
              description="Our AI finds jobs that match your skills, experience, and preferences across multiple platforms."
            />
            <FeatureCard 
              icon={Bot}
              title="Auto-Apply"
              description="Applications are submitted automatically with customized cover letters and optimized answers."
            />
            <FeatureCard 
              icon={Mail}
              title="Email Monitoring"
              description="We track recruiter responses, interview invites, and follow up on your behalf."
            />
            <FeatureCard 
              icon={Clock}
              title="24/7 Operation"
              description="The agent runs continuously, applying to new jobs as soon as they're posted."
            />
            <FeatureCard 
              icon={Shield}
              title="Secure & Private"
              description="We never store your passwords. Sessions are encrypted and you can revoke access anytime."
            />
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-20 px-4 bg-secondary/30">
        <div className="container max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Your Privacy, Protected</h2>
            <p className="text-muted-foreground text-lg">Built with security-first principles</p>
          </div>

          <div className="space-y-4">
            <TrustItem text="We never store your passwords—only secure session tokens" />
            <TrustItem text="All data is encrypted at rest and in transit" />
            <TrustItem text="You can revoke access to any connected account anytime" />
            <TrustItem text="Your resume and personal data are never shared" />
            <TrustItem text="Complete activity logs so you know exactly what the agent did" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="container max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to automate your job search?
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            Join thousands of job seekers who let our AI do the heavy lifting.
          </p>
          <Link to="/auth?signup=true">
            <Button size="lg" className="text-lg px-8 gap-2">
              Get Started Free <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="container max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">Career Compass</span>
          </div>
          <div className="text-sm text-muted-foreground">
            © 2024 Career Compass. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }: { 
  icon: React.ElementType; 
  title: string; 
  description: string; 
}) {
  return (
    <div className="flex gap-4 p-6 rounded-xl border border-border bg-card hover:shadow-md transition-shadow">
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function TrustItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-card border border-border">
      <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
      <span>{text}</span>
    </div>
  );
}
