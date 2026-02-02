import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, CheckCircle2, Sparkles, Users, Zap, Clock } from "lucide-react";
import { useState } from "react";

const benefits = [
  { icon: Zap, text: "Early access to all features" },
  { icon: Users, text: "Founding member pricing" },
  { icon: Clock, text: "Priority support forever" },
];

export const FinalCTA = () => {
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
    <section className="py-32 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 hero-gradient" />
      <div className="absolute inset-0 bg-hero-pattern opacity-20" />
      
      {/* Animated orbs */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary/20 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/20 rounded-full blur-3xl animate-float" style={{ animationDelay: "-3s" }} />
      
      <div className="container px-4 relative z-10">
        <div className="max-w-4xl mx-auto">
          <div className="glass-card rounded-3xl p-8 md:p-12 border border-primary-foreground/10 bg-primary-foreground/5 backdrop-blur-xl">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/20 text-accent mb-6">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm font-medium">Limited Launch Offer</span>
              </div>
              
              <h2 className="text-3xl md:text-5xl font-bold text-primary-foreground mb-6">
                Be Among the First to
                <span className="block mt-2 gradient-text bg-gradient-to-r from-accent via-success to-primary bg-clip-text text-transparent">
                  Automate Your Job Search
                </span>
              </h2>
              
              <p className="text-lg text-primary-foreground/70 max-w-2xl mx-auto">
                Join the waitlist today and get exclusive founding member benefits when we launch. 
                Limited spots available.
              </p>
            </div>

            {/* Benefits */}
            <div className="flex flex-wrap items-center justify-center gap-8 mb-10">
              {benefits.map((benefit) => (
                <div key={benefit.text} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-foreground/10 flex items-center justify-center">
                    <benefit.icon className="w-5 h-5 text-accent" />
                  </div>
                  <span className="text-primary-foreground/80">{benefit.text}</span>
                </div>
              ))}
            </div>

            {/* Form */}
            <div className="max-w-lg mx-auto">
              {!isSubmitted ? (
                <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4">
                  <Input
                    type="email"
                    placeholder="Enter your email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-14 px-6 bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground placeholder:text-primary-foreground/50 rounded-xl text-lg flex-1"
                    required
                  />
                  <Button type="submit" variant="hero" size="xl" className="group whitespace-nowrap">
                    Get Early Access
                    <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                  </Button>
                </form>
              ) : (
                <div className="p-6 rounded-2xl border border-success/30 bg-success/10">
                  <div className="flex items-center justify-center gap-3 text-success">
                    <CheckCircle2 className="w-6 h-6" />
                    <span className="text-lg font-semibold">Welcome to the future! We'll be in touch soon.</span>
                  </div>
                </div>
              )}
              
              <div className="flex items-center justify-center gap-2 mt-6">
                <div className="flex -space-x-2">
                  {[...Array(5)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/80 to-accent/80 border-2 border-card flex items-center justify-center text-xs text-primary-foreground font-medium"
                    >
                      {String.fromCharCode(65 + i)}
                    </div>
                  ))}
                </div>
                <span className="text-sm text-primary-foreground/60 ml-2">
                  Join 2,500+ job seekers on the waitlist
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
