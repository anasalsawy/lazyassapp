import { ComingSoonNavbar } from "@/components/landing/ComingSoonNavbar";
import { ComingSoonHero } from "@/components/landing/ComingSoonHero";
import { DemoVideo } from "@/components/landing/DemoVideo";
import { FeatureShowcase } from "@/components/landing/FeatureShowcase";
import { HowItWorksDetailed } from "@/components/landing/HowItWorksDetailed";
import { Roadmap } from "@/components/landing/Roadmap";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { ComingSoonFooter } from "@/components/landing/ComingSoonFooter";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <ComingSoonNavbar />
      <ComingSoonHero />
      <div id="demo">
        <DemoVideo />
      </div>
      <div id="features">
        <FeatureShowcase />
      </div>
      <div id="how-it-works">
        <HowItWorksDetailed />
      </div>
      <div id="roadmap">
        <Roadmap />
      </div>
      <div id="waitlist">
        <FinalCTA />
      </div>
      <ComingSoonFooter />
    </div>
  );
};

export default Index;
