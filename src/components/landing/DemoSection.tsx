import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, Bot, Sparkles, Send, Mail } from "lucide-react";

export function DemoSection() {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <section className="py-20 px-4">
      <div className="container max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            See It In Action
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Watch how our AI agent searches for jobs, optimizes your resume, and
            applies automatically—all while you focus on what matters.
          </p>
        </div>

        {/* Video/Demo Container */}
        <div className="relative max-w-4xl mx-auto">
          {/* Video placeholder with animated demo */}
          <div className="aspect-video rounded-2xl bg-gradient-to-br from-primary/20 via-secondary to-accent/20 border border-border overflow-hidden relative">
            {/* Animated background grid */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />

            {/* Demo content */}
            <div className="absolute inset-0 flex items-center justify-center">
              {!isPlaying ? (
                <div className="text-center">
                  <Button
                    size="lg"
                    className="rounded-full w-20 h-20 mb-4"
                    onClick={() => setIsPlaying(true)}
                  >
                    <Play className="w-8 h-8" />
                  </Button>
                  <p className="text-muted-foreground">Watch 2-minute demo</p>
                </div>
              ) : (
                <div className="w-full h-full p-8">
                  {/* Animated workflow visualization */}
                  <div className="flex items-center justify-center h-full gap-8">
                    {/* Step 1: Resume */}
                    <div className="flex flex-col items-center animate-pulse">
                      <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mb-2">
                        <Sparkles className="w-8 h-8 text-primary" />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        Resume Optimized
                      </span>
                    </div>

                    {/* Arrow */}
                    <div className="w-8 h-0.5 bg-gradient-to-r from-primary to-transparent" />

                    {/* Step 2: AI Agent */}
                    <div
                      className="flex flex-col items-center animate-pulse"
                      style={{ animationDelay: "0.2s" }}
                    >
                      <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center mb-2 shadow-lg shadow-primary/30">
                        <Bot className="w-10 h-10 text-primary-foreground animate-bounce" />
                      </div>
                      <span className="text-sm font-medium">Agent Working</span>
                    </div>

                    {/* Arrow */}
                    <div className="w-8 h-0.5 bg-gradient-to-r from-primary to-transparent" />

                    {/* Step 3: Applications */}
                    <div
                      className="flex flex-col items-center animate-pulse"
                      style={{ animationDelay: "0.4s" }}
                    >
                      <div className="w-16 h-16 rounded-2xl bg-success/20 flex items-center justify-center mb-2">
                        <Send className="w-8 h-8 text-success" />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        Applications Sent
                      </span>
                    </div>

                    {/* Arrow */}
                    <div className="w-8 h-0.5 bg-gradient-to-r from-success to-transparent" />

                    {/* Step 4: Responses */}
                    <div
                      className="flex flex-col items-center animate-pulse"
                      style={{ animationDelay: "0.6s" }}
                    >
                      <div className="w-16 h-16 rounded-2xl bg-accent/20 flex items-center justify-center mb-2">
                        <Mail className="w-8 h-8 text-accent-foreground" />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        Interviews!
                      </span>
                    </div>
                  </div>

                  {/* Pause button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-4 right-4"
                    onClick={() => setIsPlaying(false)}
                  >
                    <Pause className="w-4 h-4 mr-1" />
                    Pause
                  </Button>
                </div>
              )}
            </div>

            {/* Decorative elements */}
            <div className="absolute top-4 left-4 flex gap-2">
              <div className="w-3 h-3 rounded-full bg-destructive/60" />
              <div className="w-3 h-3 rounded-full bg-warning/60" />
              <div className="w-3 h-3 rounded-full bg-success/60" />
            </div>
          </div>

          {/* Feature highlights below video */}
          <div className="grid grid-cols-3 gap-4 mt-8">
            <div className="text-center p-4 rounded-xl bg-card border border-border">
              <div className="text-2xl font-bold text-primary">24/7</div>
              <div className="text-sm text-muted-foreground">
                Always Running
              </div>
            </div>
            <div className="text-center p-4 rounded-xl bg-card border border-border">
              <div className="text-2xl font-bold text-primary">50+</div>
              <div className="text-sm text-muted-foreground">
                Daily Applications
              </div>
            </div>
            <div className="text-center p-4 rounded-xl bg-card border border-border">
              <div className="text-2xl font-bold text-primary">100%</div>
              <div className="text-sm text-muted-foreground">
                Logged & Tracked
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
