import { Play, Pause, Volume2, VolumeX, Maximize2 } from "lucide-react";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { AspectRatio } from "@/components/ui/aspect-ratio";

export const DemoVideo = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  return (
    <section className="py-24 bg-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[1000px] bg-gradient-radial from-primary/5 to-transparent rounded-full" />
      
      <div className="container px-4 relative z-10">
        {/* Section header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
            <Play className="w-4 h-4" />
            <span className="text-sm font-medium">See It In Action</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-6">
            Watch How AutoApply
            <span className="gradient-text block mt-2">Transforms Your Job Search</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            From resume upload to job offers — see the complete automation in under 2 minutes
          </p>
        </div>

        {/* Video Player Container */}
        <div className="max-w-5xl mx-auto">
          <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-border/50 group">
            <AspectRatio ratio={16 / 9}>
              {/* Video placeholder with animated demo */}
              <div className="absolute inset-0 bg-gradient-to-br from-foreground via-foreground/95 to-foreground/90">
                {/* Simulated UI preview */}
                <div className="absolute inset-0 flex items-center justify-center">
                  {/* Fake dashboard preview */}
                  <div className="w-full h-full p-8 flex flex-col">
                    {/* Fake header */}
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/20" />
                        <div className="h-4 w-24 bg-card/20 rounded" />
                      </div>
                      <div className="flex gap-2">
                        <div className="h-8 w-20 bg-card/10 rounded-lg" />
                        <div className="h-8 w-20 bg-primary/30 rounded-lg" />
                      </div>
                    </div>
                    
                    {/* Fake content */}
                    <div className="flex-1 grid grid-cols-3 gap-6">
                      {/* Sidebar */}
                      <div className="col-span-1 space-y-4">
                        <div className="h-12 bg-card/10 rounded-xl animate-pulse" />
                        <div className="h-12 bg-primary/20 rounded-xl" />
                        <div className="h-12 bg-card/10 rounded-xl" />
                        <div className="h-12 bg-card/10 rounded-xl" />
                        <div className="h-12 bg-accent/20 rounded-xl animate-pulse" style={{ animationDelay: "0.5s" }} />
                      </div>
                      
                      {/* Main content */}
                      <div className="col-span-2 space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                          <div className="h-24 bg-success/20 rounded-xl flex items-center justify-center">
                            <span className="text-2xl font-bold text-success">127</span>
                          </div>
                          <div className="h-24 bg-primary/20 rounded-xl flex items-center justify-center">
                            <span className="text-2xl font-bold text-primary">89%</span>
                          </div>
                          <div className="h-24 bg-accent/20 rounded-xl flex items-center justify-center">
                            <span className="text-2xl font-bold text-accent">12</span>
                          </div>
                        </div>
                        <div className="h-40 bg-card/10 rounded-xl p-4 space-y-3">
                          <div className="h-8 bg-card/20 rounded-lg w-3/4 animate-pulse" />
                          <div className="h-8 bg-success/30 rounded-lg w-full" />
                          <div className="h-8 bg-card/20 rounded-lg w-5/6 animate-pulse" style={{ animationDelay: "0.3s" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Play button overlay */}
                <div 
                  className="absolute inset-0 flex items-center justify-center bg-foreground/40 backdrop-blur-sm transition-opacity cursor-pointer group-hover:bg-foreground/50"
                  onClick={() => setIsPlaying(!isPlaying)}
                >
                  <div className="w-24 h-24 rounded-full bg-primary flex items-center justify-center shadow-2xl transition-transform group-hover:scale-110 glow">
                    {isPlaying ? (
                      <Pause className="w-10 h-10 text-primary-foreground" />
                    ) : (
                      <Play className="w-10 h-10 text-primary-foreground ml-1" />
                    )}
                  </div>
                </div>
              </div>
            </AspectRatio>
            
            {/* Video controls */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-foreground/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-card hover:text-card hover:bg-card/20"
                    onClick={() => setIsPlaying(!isPlaying)}
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-card hover:text-card hover:bg-card/20"
                    onClick={() => setIsMuted(!isMuted)}
                  >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </Button>
                  <span className="text-sm text-card/80">0:00 / 1:58</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-card hover:text-card hover:bg-card/20"
                >
                  <Maximize2 className="w-5 h-5" />
                </Button>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-1 bg-card/30 rounded-full overflow-hidden">
                <div className="h-full w-0 bg-primary rounded-full" />
              </div>
            </div>
          </div>
          
          {/* Video caption */}
          <p className="text-center text-sm text-muted-foreground mt-6">
            Full demo video coming soon — sign up to be notified when it's ready
          </p>
        </div>
      </div>
    </section>
  );
};
