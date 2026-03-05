import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play,
  Pause,
  RotateCcw,
  Search,
  Brain,
  Zap,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Globe,
  MousePointer,
  FileText,
  CreditCard,
} from "lucide-react";

interface SimStep {
  agent: "researcher" | "planner" | "executor" | "system";
  type: string;
  label: string;
  phase?: string;
  json: any;
  icon: React.ElementType;
  delay: number; // ms before this step appears
}

const GALVESTON_SIM: SimStep[] = [
  {
    agent: "system",
    type: "TASK_SPEC",
    label: "Task Received",
    icon: FileText,
    delay: 0,
    json: {
      goal: "Book a nice beachfront rental in Galveston, TX",
      success_criteria: ["Reservation confirmed with confirmation number"],
      context: { location: "Galveston, TX", type: "beachfront vacation rental" },
    },
  },
  {
    agent: "researcher",
    type: "RESEARCHER_ROUTE",
    label: "Strategic Route Plan",
    icon: Search,
    delay: 1200,
    json: {
      run_id: "sim-001",
      route_version: 1,
      goal_decomposition: "Research → Compare → Book",
      phases: [
        {
          phase_id: "p1-research",
          phase_name: "Research Beachfront Rentals",
          objective: "Find 3-5 beachfront properties with ratings & prices",
          sites: [
            { domain: "vrbo.com", priority: 1, strategy_notes: "Best beachfront filter" },
            { domain: "airbnb.com", priority: 2, strategy_notes: "Strong inventory, needs login" },
          ],
          estimated_steps: 12,
        },
        {
          phase_id: "p2-compare",
          phase_name: "Compare & Select",
          objective: "Rank by value, select best",
          estimated_steps: 3,
        },
        {
          phase_id: "p3-book",
          phase_name: "Book Selected Property",
          objective: "Complete reservation checkout",
          estimated_steps: 15,
        },
      ],
      domain_allowlist: ["vrbo.com", "airbnb.com", "google.com", "booking.com"],
      total_estimated_steps: 30,
    },
  },
  {
    agent: "planner",
    type: "EXECUTOR_DIRECTIVE",
    label: "Navigate to VRBO search",
    phase: "p1-research",
    icon: Globe,
    delay: 800,
    json: {
      turn_id: "t1",
      action_id: "a1",
      current_phase_id: "p1-research",
      intent: "navigate",
      args: { url: "https://www.vrbo.com/search?destination=Galveston+TX&amenity=beachfront" },
      risk_level: "low",
    },
  },
  {
    agent: "executor",
    type: "EXECUTOR_RESULT",
    label: "VRBO search results loaded",
    phase: "p1-research",
    icon: CheckCircle2,
    delay: 2000,
    json: {
      action_id: "a1",
      status: "success",
      observed: {
        url: "https://www.vrbo.com/search/keywords:galveston-tx-beachfront",
        title: "Galveston Beachfront Vacation Rentals | Vrbo",
        notices: ["Cookie consent banner visible"],
      },
      page_content:
        "247 Beachfront Rentals found:\n1. Gulf Breeze Condo — $189/night ★4.8\n2. Oceanview Suite — $245/night ★4.9\n3. Sand Dollar House — $320/night ★4.7\n4. Seawall Studio — $129/night ★4.5",
      timing: { elapsed_ms: 4200 },
    },
  },
  {
    agent: "planner",
    type: "EXECUTOR_DIRECTIVE",
    label: "Dismiss cookie banner",
    phase: "p1-research",
    icon: MousePointer,
    delay: 600,
    json: {
      turn_id: "t2",
      action_id: "a2",
      intent: "click",
      grounding: { primary_locator: "button[aria-label='Accept cookies']" },
      risk_level: "low",
    },
  },
  {
    agent: "executor",
    type: "EXECUTOR_RESULT",
    label: "Cookie banner dismissed",
    phase: "p1-research",
    icon: CheckCircle2,
    delay: 1000,
    json: { action_id: "a2", status: "success", change_observation: { summary: "Cookie banner closed", new_modal_detected: false } },
  },
  {
    agent: "planner",
    type: "EXECUTOR_DIRECTIVE",
    label: "Extract top 5 listings",
    phase: "p1-research",
    icon: FileText,
    delay: 500,
    json: {
      turn_id: "t3",
      action_id: "a3",
      intent: "extract",
      grounding: { primary_locator: ".property-card" },
      args: { extract_spec: { fields: ["name", "price", "rating", "reviews"] } },
      risk_level: "low",
    },
  },
  {
    agent: "executor",
    type: "EXECUTOR_RESULT",
    label: "5 properties extracted",
    phase: "p1-research",
    icon: CheckCircle2,
    delay: 1500,
    json: {
      action_id: "a3",
      status: "success",
      extracted_data: [
        { name: "Gulf Breeze Beachfront Condo", price: 189, rating: 4.8, reviews: 142 },
        { name: "Oceanview Paradise Suite", price: 245, rating: 4.9, reviews: 89 },
        { name: "Sand Dollar Beach House", price: 320, rating: 4.7, reviews: 203 },
        { name: "Seawall Sunset Studio", price: 129, rating: 4.5, reviews: 67 },
        { name: "Tiki Island Retreat", price: 275, rating: 4.6, reviews: 31 },
      ],
    },
  },
  {
    agent: "planner",
    type: "PHASE_TRANSITION",
    label: "Phase p1 ✓ → Entering p2-compare",
    phase: "p2-compare",
    icon: Brain,
    delay: 400,
    json: {
      from_phase: "p1-research",
      to_phase: "p2-compare",
      criteria_met: "3+ beachfront properties identified",
      selected: "Gulf Breeze Beachfront Condo",
      reason: "Best value: $189/night with highest review count (142) and ★4.8 rating",
    },
  },
  {
    agent: "planner",
    type: "EXECUTOR_DIRECTIVE",
    label: "Navigate to listing detail page",
    phase: "p3-book",
    icon: Globe,
    delay: 600,
    json: {
      turn_id: "t4",
      action_id: "a4",
      current_phase_id: "p3-book",
      intent: "navigate",
      args: { url: "https://www.vrbo.com/listing/gulf-breeze-beachfront-condo" },
      risk_level: "low",
    },
  },
  {
    agent: "executor",
    type: "EXECUTOR_RESULT",
    label: "Listing page loaded",
    phase: "p3-book",
    icon: CheckCircle2,
    delay: 1800,
    json: {
      action_id: "a4",
      status: "success",
      observed: {
        title: "Gulf Breeze Beachfront Condo — Galveston",
        notices: ["Book Now button visible", "Calendar date picker available"],
      },
    },
  },
  {
    agent: "planner",
    type: "EXECUTOR_DIRECTIVE",
    label: "Click 'Book Now'",
    phase: "p3-book",
    icon: MousePointer,
    delay: 500,
    json: { turn_id: "t5", action_id: "a5", intent: "click", grounding: { primary_locator: "button:has-text('Book Now')" }, risk_level: "medium" },
  },
  {
    agent: "executor",
    type: "EXECUTOR_RESULT",
    label: "Checkout page loaded",
    phase: "p3-book",
    icon: CheckCircle2,
    delay: 2000,
    json: {
      action_id: "a5",
      status: "success",
      observed: { url: "https://www.vrbo.com/checkout/gulf-breeze", title: "Complete Your Booking" },
      change_observation: { summary: "Checkout form visible: guest info, payment, total $756 (4 nights)" },
    },
  },
  {
    agent: "planner",
    type: "EXECUTOR_DIRECTIVE",
    label: "Fill guest info & payment",
    phase: "p3-book",
    icon: CreditCard,
    delay: 500,
    json: {
      turn_id: "t6",
      action_id: "a6",
      intent: "type",
      args: { text: "[Guest info + stored payment card]" },
      risk_level: "high",
      note: "Using stored payment card from user profile",
    },
  },
  {
    agent: "executor",
    type: "EXECUTOR_RESULT",
    label: "Payment submitted, confirmation received",
    phase: "p3-book",
    icon: CheckCircle2,
    delay: 3000,
    json: {
      action_id: "a6",
      status: "success",
      observed: {
        url: "https://www.vrbo.com/booking/confirmation/VR-8847291",
        title: "Booking Confirmed!",
      },
      extracted_data: { confirmation_number: "VR-8847291", total: "$756.00", property: "Gulf Breeze Beachfront Condo" },
    },
  },
  {
    agent: "planner",
    type: "FINAL_RESULT",
    label: "Task Complete ✓",
    icon: CheckCircle2,
    delay: 800,
    json: {
      success: true,
      summary: "Booked 'Gulf Breeze Beachfront Condo' in Galveston, TX — $189/night × 4 nights = $756. Confirmation #VR-8847291.",
      steps_taken: 16,
      phases_completed: ["p1-research", "p2-compare", "p3-book"],
    },
  },
];

const AGENT_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  system: { bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border/40", label: "System" },
  researcher: { bg: "bg-chart-1/10", text: "text-chart-1", border: "border-chart-1/30", label: "Researcher" },
  planner: { bg: "bg-primary/10", text: "text-primary", border: "border-primary/30", label: "Planner" },
  executor: { bg: "bg-chart-4/10", text: "text-chart-4", border: "border-chart-4/30", label: "Executor" },
};

export function SimulationReplay() {
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isPlaying || visibleSteps >= GALVESTON_SIM.length) {
      if (visibleSteps >= GALVESTON_SIM.length) setIsPlaying(false);
      return;
    }

    const nextStep = GALVESTON_SIM[visibleSteps];
    timerRef.current = setTimeout(() => {
      setVisibleSteps((v) => v + 1);
    }, nextStep.delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, visibleSteps]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleSteps]);

  const toggleExpand = (i: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const reset = () => {
    setIsPlaying(false);
    setVisibleSteps(0);
    setExpandedSteps(new Set());
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const playPause = () => {
    if (visibleSteps >= GALVESTON_SIM.length) {
      reset();
      setTimeout(() => setIsPlaying(true), 100);
    } else {
      setIsPlaying((p) => !p);
    }
  };

  const currentPhase = visibleSteps > 0 ? GALVESTON_SIM[visibleSteps - 1]?.phase : undefined;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-display text-lg">Simulation Replay</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              "book me a nice beachfront in galveston"
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Phase indicator */}
            {currentPhase && (
              <Badge variant="outline" className="rounded-full text-xs">
                Phase: {currentPhase}
              </Badge>
            )}
            <Badge variant="secondary" className="rounded-full tabular-nums">
              {visibleSteps}/{GALVESTON_SIM.length} steps
            </Badge>
            <Button size="sm" variant="ghost" onClick={reset} className="h-8 w-8 p-0">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" onClick={playPause} className="h-8 rounded-full gap-1.5 px-3">
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? "Pause" : visibleSteps >= GALVESTON_SIM.length ? "Replay" : "Play"}
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-secondary/50 rounded-full mt-3 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${(visibleSteps / GALVESTON_SIM.length) * 100}%` }}
          />
        </div>

        {/* Agent legend */}
        <div className="flex gap-3 mt-3">
          {Object.entries(AGENT_COLORS).filter(([k]) => k !== "system").map(([key, style]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${style.bg} border ${style.border}`} />
              <span className="text-xs text-muted-foreground">{style.label}</span>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <ScrollArea className="h-[500px]" ref={scrollRef}>
          <div className="space-y-2 pr-2">
            {GALVESTON_SIM.slice(0, visibleSteps).map((step, i) => {
              const style = AGENT_COLORS[step.agent];
              const Icon = step.icon;
              const isExpanded = expandedSteps.has(i);
              const isLatest = i === visibleSteps - 1;
              const isFinal = step.type === "FINAL_RESULT";

              return (
                <div
                  key={i}
                  className={`rounded-xl border transition-all duration-500 ${
                    isLatest ? `${style.border} ${style.bg} shadow-md animate-in fade-in slide-in-from-bottom-2` : `border-border/20 hover:border-border/40`
                  } ${isFinal ? "ring-2 ring-primary/20" : ""}`}
                >
                  <button
                    className="w-full flex items-center gap-3 p-3 text-left"
                    onClick={() => toggleExpand(i)}
                  >
                    {/* Timeline dot + connector */}
                    <div className="flex flex-col items-center self-stretch">
                      <div className={`w-8 h-8 rounded-lg ${style.bg} border ${style.border} flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`w-4 h-4 ${style.text}`} />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge className={`${style.bg} ${style.text} border-0 rounded-full text-[10px] px-2 py-0`}>
                          {style.label}
                        </Badge>
                        <Badge variant="outline" className="rounded-full text-[10px] px-1.5 py-0 font-mono">
                          {step.type}
                        </Badge>
                        {step.phase && (
                          <span className="text-[10px] text-muted-foreground">{step.phase}</span>
                        )}
                      </div>
                      <p className={`text-sm font-medium mt-0.5 ${isFinal ? style.text : ""}`}>
                        {step.label}
                      </p>
                    </div>

                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 pl-14">
                      <pre className="text-xs bg-background/60 rounded-lg p-3 overflow-auto max-h-48 border border-border/20 font-mono leading-relaxed">
                        {JSON.stringify(step.json, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}

            {visibleSteps === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <Play className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Press Play to start the simulation</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
