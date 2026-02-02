import { Briefcase, Github, Twitter, Linkedin, Mail } from "lucide-react";
import { Link } from "react-router-dom";

export const ComingSoonFooter = () => {
  return (
    <footer className="py-16 bg-foreground border-t border-primary-foreground/10">
      <div className="container px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            {/* Brand */}
            <div className="md:col-span-2">
              <Link to="/" className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
                  <Briefcase className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="font-bold text-2xl text-primary-foreground">AutoApply</span>
              </Link>
              <p className="text-primary-foreground/60 max-w-sm mb-6">
                The AI-powered job automation platform that handles your entire job search — 
                from resume optimization to application submission.
              </p>
              <div className="flex items-center gap-4">
                <a 
                  href="#" 
                  className="w-10 h-10 rounded-lg bg-primary-foreground/10 flex items-center justify-center text-primary-foreground/60 hover:text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
                >
                  <Twitter className="w-5 h-5" />
                </a>
                <a 
                  href="#" 
                  className="w-10 h-10 rounded-lg bg-primary-foreground/10 flex items-center justify-center text-primary-foreground/60 hover:text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
                >
                  <Linkedin className="w-5 h-5" />
                </a>
                <a 
                  href="#" 
                  className="w-10 h-10 rounded-lg bg-primary-foreground/10 flex items-center justify-center text-primary-foreground/60 hover:text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
                >
                  <Github className="w-5 h-5" />
                </a>
                <a 
                  href="mailto:hello@autoapply.ai" 
                  className="w-10 h-10 rounded-lg bg-primary-foreground/10 flex items-center justify-center text-primary-foreground/60 hover:text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
                >
                  <Mail className="w-5 h-5" />
                </a>
              </div>
            </div>

            {/* Links */}
            <div>
              <h4 className="font-semibold text-primary-foreground mb-4">Product</h4>
              <ul className="space-y-3">
                <li>
                  <a href="#features" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#how-it-works" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                    How It Works
                  </a>
                </li>
                <li>
                  <a href="#roadmap" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                    Roadmap
                  </a>
                </li>
                <li>
                  <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                    Pricing
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-primary-foreground mb-4">Company</h4>
              <ul className="space-y-3">
                <li>
                  <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                    About Us
                  </a>
                </li>
                <li>
                  <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                    Blog
                  </a>
                </li>
                <li>
                  <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                    Terms of Service
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom */}
          <div className="pt-8 border-t border-primary-foreground/10 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-primary-foreground/50">
              © 2026 AutoApply. All rights reserved.
            </p>
            <p className="text-sm text-primary-foreground/50">
              Made with ❤️ for job seekers everywhere
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};
