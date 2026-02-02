import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";

const benefits = [
  "No credit card required",
  "10 free applications",
  "Cancel anytime",
];

export const CTA = () => {
  return (
    <section className="py-24 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 hero-gradient" />
      <div className="absolute inset-0 bg-hero-pattern opacity-20" />
      
      <div className="container px-4 relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-card mb-6">
            Ready to Automate Your
            <span className="block gradient-text">Job Search?</span>
          </h2>
          <p className="text-lg text-card/70 mb-8">
            Join thousands of job seekers who've landed their dream jobs with our AI-powered platform.
          </p>

          {/* Benefits */}
          <div className="flex flex-wrap items-center justify-center gap-6 mb-10">
            {benefits.map((benefit) => (
              <div key={benefit} className="flex items-center gap-2 text-card/80">
                <CheckCircle2 className="w-5 h-5 text-accent" />
                <span className="text-sm">{benefit}</span>
              </div>
            ))}
          </div>

          {/* CTA Button */}
          <Link to="/dashboard">
            <Button variant="hero" size="xl" className="group">
              Start Applying Now
              <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};
