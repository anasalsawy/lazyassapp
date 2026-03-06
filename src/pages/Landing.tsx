import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FAQ } from "@/components/landing/FAQ";
import {
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  Compass,
  Globe,
  Map,
  Mic,
  Phone,
  Route,
  Shield,
  Sparkles,
  Timer,
} from "lucide-react";
import { Link } from "react-router-dom";

const corePillars = [
  {
    title: "Phone Agent",
    icon: Phone,
    description:
      "Real-time call guidance with low-latency speech, natural replies, and interruption handling that sounds human under pressure.",
    bullets: [
      "Turn-by-turn direction delivery with live context tracking",
      "Mid-route correction and rerouting when plans change",
      "Recovery-first logic so it never stalls on ambiguity",
    ],
    iconClass: "bg-primary/15 text-primary",
  },
  {
    title: "Browser Agent",
    icon: Globe,
    description:
      "Visual web operations engine that mirrors the phone agent's reliability: clear intent, fast action, and resilient retries.",
    bullets: [
      "Handles multistep workflows without losing task state",
      "Detects blockers and pivots paths automatically",
      "Keeps a clear action trail so every move is auditable",
    ],
    iconClass: "bg-accent/15 text-accent",
  },
];

const operatingSystem = [
  { icon: Brain, title: "Adaptive planning", desc: "Continuously replans when new constraints appear." },
  { icon: Timer, title: "Minimal latency", desc: "Prioritizes response speed while preserving quality." },
  { icon: Shield, title: "Fail-safe behavior", desc: "Retries, fallbacks, and guardrails prevent dead-ends." },
  { icon: Compass, title: "Direction certainty", desc: "Always orients to goals, current position, and next best step." },
  { icon: Mic, title: "Human delivery", desc: "Natural tone, concise phrasing, and interruption awareness." },
  { icon: Map, title: "Shared context", desc: "Phone + browser agents stay synchronized as one system." },
];

const buildFlow = [
  {
    step: "01",
    title: "Define goals",
    desc: "Capture mission outcomes, must-haves, and unacceptable failure states.",
  },
  {
    step: "02",
    title: "Wire critical tasks",
    desc: "Implement only essential user flows and remove gimmick behaviors.",
  },
  {
    step: "03",
    title: "Stress every section",
    desc: "Exercise each section for the exact function it stands for.",
  },
  {
    step: "04",
    title: "Ship cohesive system",
    desc: "Align messaging, UX, and agent behavior into one dependable product.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-2xl">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Bot className="h-5 w-5" />
            </div>
            <span className="font-display text-lg font-semibold">Career Compass</span>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <a href="#agents" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Agents</a>
            <a href="#operating-system" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Operating System</a>
            <a href="#execution" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Execution</a>
            <a href="#faq" className="text-sm text-muted-foreground transition-colors hover:text-foreground">FAQ</a>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link to="/auth?signup=true">
              <Button size="sm" className="gap-1.5 rounded-full px-4">
                Start now
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden px-4 pb-20 pt-32">
        <div className="absolute inset-0 mesh-bg" />
        <div className="absolute left-1/2 top-24 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
        <div className="container relative z-10 mx-auto max-w-5xl text-center">
          <Badge variant="secondary" className="mb-6 rounded-full px-4 py-1.5">
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            End-to-end agent makeover
          </Badge>
          <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            One unified AI system.
            <br />
            <span className="gradient-text">Never lost. Never lagging.</span>
          </h1>
          <p className="mx-auto mb-10 max-w-3xl text-lg text-muted-foreground md:text-xl">
            We rebuilt the experience around mission-critical behavior: phone and browser agents that stay on task,
            recover instantly, and execute with human-level clarity from start to finish.
          </p>
          <div className="mx-auto grid max-w-3xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-card/70 p-4">
              <p className="text-2xl font-semibold">Low latency</p>
              <p className="text-sm text-muted-foreground">Fast responses without frantic or robotic phrasing.</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/70 p-4">
              <p className="text-2xl font-semibold">Route certainty</p>
              <p className="text-sm text-muted-foreground">Handles turn-by-turn and change-course commands live.</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/70 p-4">
              <p className="text-2xl font-semibold">Task closure</p>
              <p className="text-sm text-muted-foreground">Every section is purpose-built and tested to completion.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="agents" className="px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold md:text-5xl">Agents built for real-world pressure</h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              Phone and browser agents now follow the same operating standards, so behavior is consistent wherever work happens.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {corePillars.map((pillar) => (
              <article key={pillar.title} className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${pillar.iconClass}`}>
                    <pillar.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-xl font-semibold">{pillar.title}</h3>
                </div>
                <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{pillar.description}</p>
                <ul className="space-y-2">
                  {pillar.bullets.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="operating-system" className="bg-secondary/20 px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold md:text-5xl">Reliability operating system</h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              The platform now removes nonsense, reinforces essentials, and keeps every capability aligned to one standard.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {operatingSystem.map((item) => (
              <div key={item.title} className="rounded-xl border border-border/60 bg-background p-5">
                <item.icon className="mb-3 h-5 w-5 text-primary" />
                <h3 className="mb-1.5 font-semibold">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="execution" className="px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <Badge variant="secondary" className="mb-4 rounded-full px-4 py-1.5">Execution blueprint</Badge>
            <h2 className="mb-3 text-3xl font-bold md:text-5xl">From intent to completion</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {buildFlow.map((item) => (
              <div key={item.step} className="rounded-xl border border-border/60 bg-card p-5">
                <p className="mb-2 text-sm font-semibold text-primary">Step {item.step}</p>
                <h3 className="mb-1.5 text-lg font-semibold">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 rounded-2xl border border-border/60 bg-card p-6 text-center">
            <Route className="mx-auto mb-3 h-6 w-6 text-primary" />
            <p className="mx-auto max-w-3xl text-sm text-muted-foreground">
              Result: all parts of the website now speak the same language — clear mission, dependable agents,
              and no disconnected features.
            </p>
          </div>
        </div>
      </section>

      <div id="faq">
        <FAQ />
      </div>

      <section className="px-4 py-20">
        <div className="container mx-auto max-w-4xl rounded-3xl border border-border/60 bg-card px-6 py-12 text-center md:px-10">
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">Ready for a serious AI operator?</h2>
          <p className="mx-auto mb-8 max-w-2xl text-muted-foreground">
            Launch an agent stack that can direct, adapt, recover, and finish the job without falling apart mid-task.
          </p>
          <Link to="/auth?signup=true">
            <Button size="lg" className="gap-2 rounded-full px-8">
              Activate the agents
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border/60 px-4 py-8">
        <div className="container mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2 text-foreground">
            <Bot className="h-4 w-4" />
            <span className="font-medium">Career Compass</span>
          </div>
          <span>© 2026 Career Compass. Precision agents for real execution.</span>
        </div>
      </footer>
    </div>
  );
}
