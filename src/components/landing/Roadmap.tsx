import { CheckCircle2, Circle, Clock, Rocket, Sparkles } from "lucide-react";

const roadmapItems = [
  {
    quarter: "Q4 2025",
    status: "completed",
    title: "Foundation",
    items: [
      { name: "Core platform architecture", done: true },
      { name: "User authentication & profiles", done: true },
      { name: "Resume upload & parsing", done: true },
      { name: "Job preferences system", done: true },
    ],
  },
  {
    quarter: "Q1 2026",
    status: "current",
    title: "AI Agents Launch",
    items: [
      { name: "Multi-agent orchestration system", done: true },
      { name: "AI resume optimization", done: true },
      { name: "Smart job matching algorithm", done: true },
      { name: "Auto-apply engine", done: false },
      { name: "Email inbox integration", done: false },
    ],
  },
  {
    quarter: "Q2 2026",
    status: "upcoming",
    title: "Scale & Polish",
    items: [
      { name: "Resume template library", done: false },
      { name: "Advanced analytics dashboard", done: false },
      { name: "Mobile app (iOS & Android)", done: false },
      { name: "Interview preparation AI", done: false },
    ],
  },
  {
    quarter: "Q3 2026",
    status: "upcoming",
    title: "Enterprise",
    items: [
      { name: "Team collaboration features", done: false },
      { name: "API access for developers", done: false },
      { name: "Custom AI model training", done: false },
      { name: "White-label solutions", done: false },
    ],
  },
];

const statusConfig = {
  completed: { 
    icon: CheckCircle2, 
    color: "text-success", 
    bg: "bg-success/10", 
    border: "border-success/30",
    line: "bg-success"
  },
  current: { 
    icon: Rocket, 
    color: "text-primary", 
    bg: "bg-primary/10", 
    border: "border-primary/30",
    line: "bg-primary"
  },
  upcoming: { 
    icon: Clock, 
    color: "text-muted-foreground", 
    bg: "bg-muted", 
    border: "border-muted",
    line: "bg-muted"
  },
};

export const Roadmap = () => {
  return (
    <section className="py-24 bg-secondary/30 relative overflow-hidden">
      <div className="container px-4 relative z-10">
        {/* Section header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">Development Roadmap</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-6">
            What's Coming Next
          </h2>
          <p className="text-lg text-muted-foreground">
            Follow our journey as we build the most comprehensive job automation platform
          </p>
        </div>

        {/* Roadmap timeline */}
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-4 gap-6">
            {roadmapItems.map((item, index) => {
              const status = statusConfig[item.status as keyof typeof statusConfig];
              const StatusIcon = status.icon;
              
              return (
                <div key={item.quarter} className="relative">
                  {/* Connector line */}
                  {index < roadmapItems.length - 1 && (
                    <div className={`hidden md:block absolute top-8 left-1/2 w-full h-0.5 ${status.line}`} />
                  )}
                  
                  <div className={`glass-card rounded-2xl p-6 border ${status.border} relative z-10 h-full`}>
                    {/* Status icon */}
                    <div className={`w-16 h-16 rounded-2xl ${status.bg} flex items-center justify-center mb-4 mx-auto`}>
                      <StatusIcon className={`w-8 h-8 ${status.color}`} />
                    </div>
                    
                    {/* Quarter label */}
                    <div className={`text-center mb-4`}>
                      <span className={`text-sm font-semibold ${status.color} uppercase tracking-wide`}>
                        {item.quarter}
                      </span>
                      <h3 className="text-xl font-bold text-foreground mt-1">
                        {item.title}
                      </h3>
                    </div>
                    
                    {/* Items */}
                    <ul className="space-y-2">
                      {item.items.map((subItem) => (
                        <li key={subItem.name} className="flex items-start gap-2">
                          {subItem.done ? (
                            <CheckCircle2 className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          )}
                          <span className={`text-sm ${subItem.done ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {subItem.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
