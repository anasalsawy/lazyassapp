import { Button } from "@/components/ui/button";
import { Briefcase, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

export const ComingSoonNavbar = () => {
  const [isOpen, setIsOpen] = useState(false);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
    setIsOpen(false);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-foreground/80 backdrop-blur-xl border-b border-primary-foreground/10">
      <div className="container px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl text-primary-foreground">AutoApply</span>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full bg-accent/20 text-accent text-xs font-medium ml-2">
              Coming Soon
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <button 
              onClick={() => scrollToSection("features")} 
              className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors"
            >
              Features
            </button>
            <button 
              onClick={() => scrollToSection("demo")} 
              className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors"
            >
              Demo
            </button>
            <button 
              onClick={() => scrollToSection("how-it-works")} 
              className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors"
            >
              How It Works
            </button>
            <button 
              onClick={() => scrollToSection("roadmap")} 
              className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors"
            >
              Roadmap
            </button>
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-4">
            <Link to="/auth">
              <Button variant="glass" className="text-primary-foreground border-primary-foreground/20">
                Sign In
              </Button>
            </Link>
            <Button 
              variant="hero"
              onClick={() => scrollToSection("waitlist")}
            >
              Join Waitlist
            </Button>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? (
              <X className="w-6 h-6 text-primary-foreground" />
            ) : (
              <Menu className="w-6 h-6 text-primary-foreground" />
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {isOpen && (
          <div className="md:hidden py-4 border-t border-primary-foreground/10">
            <div className="flex flex-col gap-4">
              <button 
                onClick={() => scrollToSection("features")} 
                className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors text-left"
              >
                Features
              </button>
              <button 
                onClick={() => scrollToSection("demo")} 
                className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors text-left"
              >
                Demo
              </button>
              <button 
                onClick={() => scrollToSection("how-it-works")} 
                className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors text-left"
              >
                How It Works
              </button>
              <button 
                onClick={() => scrollToSection("roadmap")} 
                className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors text-left"
              >
                Roadmap
              </button>
              <div className="flex flex-col gap-2 pt-4 border-t border-primary-foreground/10">
                <Link to="/auth">
                  <Button variant="outline" className="w-full text-primary-foreground border-primary-foreground/20">
                    Sign In
                  </Button>
                </Link>
                <Button 
                  variant="hero" 
                  className="w-full"
                  onClick={() => scrollToSection("waitlist")}
                >
                  Join Waitlist
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};
