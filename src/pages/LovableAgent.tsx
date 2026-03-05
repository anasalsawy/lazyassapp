import { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import ReactMarkdown from "react-markdown";
import {
  Bot, Send, Loader2, Heart, Code2, FileText, Search, Paintbrush,
  Activity, User, Sparkles, CheckCircle2, Circle, Zap, ChevronDown, ChevronRight,
  Database, Globe, Key, Terminal, ArrowRight, Phone, PhoneOff, Mic, Brain, Shield,
  MessageSquare,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────
type ToolStep = {
  name: string;
  args_preview: string;
  status: "running" | "done" | "error";
  preview?: string;
};

type ExecutionPlan = {
  iteration: number;
  tools: ToolStep[];
};

type CallTranscriptEntry = {
  role: string;
  content: string;
};

type CallState = {
  taskId: string;
  status: "ringing" | "running" | "completed" | "failed" | "error";
  turnCount: number;
  transcript: CallTranscriptEntry[];
  lastAnalysis: string | null;
  lastDirective: string | null;
  agentName: string;
  errorMessage: string | null;
  recordingUrl: string | null;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  executionPlan?: ExecutionPlan[];
  callState?: CallState;
  isGenerating?: boolean;
};

// ── Tool Icon Mapper ────────────────────────────────────────────────────────
function ToolIcon({ name }: { name: string }) {
  if (name.includes("database") || name.includes("query")) return <Database className="w-3.5 h-3.5" />;
  if (name.includes("http") || name.includes("fetch_website")) return <Globe className="w-3.5 h-3.5" />;
  if (name.includes("secret")) return <Key className="w-3.5 h-3.5" />;
  if (name.includes("phone") || name.includes("call")) return <Activity className="w-3.5 h-3.5" />;
  if (name.includes("edge") || name.includes("invoke")) return <Zap className="w-3.5 h-3.5" />;
  if (name.includes("search")) return <Search className="w-3.5 h-3.5" />;
  if (name.includes("write") || name.includes("replace")) return <FileText className="w-3.5 h-3.5" />;
  return <Terminal className="w-3.5 h-3.5" />;
}

// ── Friendly Tool Names ─────────────────────────────────────────────────────
function friendlyToolName(name: string): string {
  const map: Record<string, string> = {
    fetch_secret: "Fetching credential",
    list_secrets: "Listing secrets",
    http_request: "API request",
    invoke_edge_function: "Running backend function",
    make_phone_call: "Placing phone call",
    query_database: "Querying database",
    "lov-search-files": "Searching codebase",
    "lov-write": "Writing file",
    "lov-line-replace": "Editing file",
    "lov-view": "Reading file",
    "lov-add-dependency": "Installing package",
    "lov-remove-dependency": "Removing package",
    web_search: "Searching web",
    generate_image: "Generating image",
  };
  return map[name] || name.replace(/[-_]/g, " ");
}

// ── Execution Panel Component ───────────────────────────────────────────────
function ExecutionPanel({ plans, isActive }: { plans: ExecutionPlan[]; isActive: boolean }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!plans.length) return null;

  const totalSteps = plans.reduce((sum, p) => sum + p.tools.length, 0);
  const doneSteps = plans.reduce((sum, p) => sum + p.tools.filter(t => t.status === "done").length, 0);
  const allDone = doneSteps === totalSteps && !isActive;

  return (
    <div className="my-2 rounded-xl border border-border/60 bg-card/80 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        <Activity className="w-3.5 h-3.5 text-primary" />
        <span className="text-foreground/80">
          {allDone ? `Executed ${totalSteps} steps` : `Running step ${doneSteps + 1} of ${totalSteps}`}
        </span>
        {!allDone && isActive && (
          <span className="ml-auto flex items-center gap-1 text-primary">
            <Loader2 className="w-3 h-3 animate-spin" />
            Processing
          </span>
        )}
        {allDone && (
          <span className="ml-auto flex items-center gap-1 text-emerald-500">
            <CheckCircle2 className="w-3 h-3" />
            Complete
          </span>
        )}
      </button>

      {/* Steps */}
      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {plans.map((plan, pi) => (
            <div key={pi} className="space-y-1">
              {plans.length > 1 && (
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 pt-1">
                  Iteration {plan.iteration}
                </div>
              )}
              {plan.tools.map((tool, ti) => (
                <div
                  key={`${pi}-${ti}`}
                  className={`flex items-start gap-2 py-1 px-2 rounded-lg text-xs transition-colors ${
                    tool.status === "running" ? "bg-primary/5 text-foreground" :
                    tool.status === "done" ? "text-muted-foreground" :
                    "text-destructive"
                  }`}
                >
                  {tool.status === "running" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0 mt-0.5" />
                  ) : tool.status === "done" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <ToolIcon name={tool.name} />
                      <span className="font-medium">{friendlyToolName(tool.name)}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground/70 truncate">
                      {tool.args_preview}
                    </div>
                    {tool.preview && tool.status === "done" && (
                      <div className="text-[11px] text-muted-foreground/50 flex items-center gap-1 mt-0.5">
                        <ArrowRight className="w-2.5 h-2.5" />
                        {tool.preview}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Suggestions ─────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: Sparkles, text: "Run the full pipeline — optimize, search, apply", color: "text-emerald-400" },
  { icon: Code2, text: "Optimize my resume for more interviews", color: "text-rose-400" },
  { icon: Search, text: "Find jobs matching my preferences", color: "text-sky-400" },
  { icon: FileText, text: "Check my application status", color: "text-amber-400" },
  { icon: Paintbrush, text: "Help me improve the app design", color: "text-violet-400" },
  { icon: Heart, text: "What can you do?", color: "text-pink-400" },
];

// ── Main Page ───────────────────────────────────────────────────────────────
export default function LovableAgent() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentPlans, setCurrentPlans] = useState<ExecutionPlan[]>([]);
  const [phase, setPhase] = useState<"idle" | "thinking" | "executing" | "generating">("idle");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentPlans, phase]);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isLoading || !session?.access_token) return;

    const userMsg: Msg = { role: "user", content: msg };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    setPhase("thinking");
    setCurrentPlans([]);

    let assistantSoFar = "";

    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar, isGenerating: true }];
      });
    };

    try {
      const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lovable-agent`;
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      });

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.trim() === "") continue;

          // Handle custom events
          if (line.startsWith("event: ")) {
            const eventType = line.slice(7).trim();
            // Read the next data line
            const dataIdx = textBuffer.indexOf("\n");
            if (dataIdx === -1) {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
            const dataLine = textBuffer.slice(0, dataIdx);
            textBuffer = textBuffer.slice(dataIdx + 1);

            if (dataLine.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(dataLine.slice(6));
                handleAgentEvent(eventType, eventData);
              } catch { /* skip malformed */ }
            }
            continue;
          }

          if (line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              if (phase !== "generating") setPhase("generating");
              upsertAssistant(content);
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Process remaining buffer
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch { /* ignore */ }
        }
      }

      if (!assistantSoFar) {
        upsertAssistant("I processed your request. Let me know what you'd like to do next.");
      }

      // Attach execution plans to the final message
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1
            ? { ...m, executionPlan: currentPlans.length ? [...currentPlans] : undefined, isGenerating: false }
            : m
          );
        }
        return prev;
      });

    } catch (e: any) {
      console.error("[LovableAgent]", e);
      upsertAssistant(`⚠️ Error: ${e.message || "Something went wrong. Try again."}`);
    } finally {
      setIsLoading(false);
      setPhase("idle");
    }
  }, [input, isLoading, session, messages, currentPlans, phase]);

  const handleAgentEvent = useCallback((eventType: string, data: any) => {
    switch (eventType) {
      case "plan":
        setPhase("executing");
        setCurrentPlans(prev => [
          ...prev,
          {
            iteration: data.iteration,
            tools: data.tools.map((t: any) => ({ ...t, status: "running" as const })),
          },
        ]);
        break;

      case "tool_start":
        setCurrentPlans(prev => {
          const updated = [...prev];
          if (updated.length > 0) {
            const lastPlan = { ...updated[updated.length - 1] };
            lastPlan.tools = lastPlan.tools.map(t =>
              t.name === data.name && t.status === "running" ? { ...t, status: "running" as const } : t
            );
            updated[updated.length - 1] = lastPlan;
          }
          return updated;
        });
        break;

      case "tool_done":
        setCurrentPlans(prev => {
          const updated = [...prev];
          if (updated.length > 0) {
            const lastPlan = { ...updated[updated.length - 1] };
            let found = false;
            lastPlan.tools = lastPlan.tools.map(t => {
              if (t.name === data.name && t.status === "running" && !found) {
                found = true;
                return { ...t, status: "done" as const, preview: data.preview };
              }
              return t;
            });
            updated[updated.length - 1] = lastPlan;
          }
          return updated;
        });
        break;

      case "tools_complete":
        setPhase("generating");
        break;

      case "phase":
        if (data.status === "generating") setPhase("generating");
        break;

      case "error":
        console.error("[agent event] Error:", data.message);
        break;
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Messages Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
                <div className="relative">
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-rose-500 via-pink-500 to-violet-500 flex items-center justify-center shadow-2xl shadow-rose-500/30">
                    <Heart className="w-10 h-10 text-white" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-amber-500 border-4 border-background flex items-center justify-center">
                    <Code2 className="w-3 h-3 text-white" />
                  </div>
                </div>

                <div className="text-center space-y-2">
                  <h1 className="text-3xl font-display font-bold">Lovable Agent</h1>
                  <p className="text-muted-foreground text-lg max-w-md">
                    Your AI orchestrator — plans, executes, and delivers. Watch every step in real time.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s.text)}
                      className="flex items-center gap-3 p-3.5 rounded-xl border border-border/60 bg-card/50 hover:bg-card hover:border-primary/30 transition-all text-left group"
                    >
                      <s.icon className={`w-5 h-5 ${s.color} shrink-0 group-hover:scale-110 transition-transform`} />
                      <span className="text-sm text-foreground/80 group-hover:text-foreground">{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                    {msg.role === "assistant" && (
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center shrink-0 mt-1">
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div className={`max-w-[85%] min-w-0 ${msg.role === "user" ? "" : ""}`}>
                      {/* Execution plan panel (before content) */}
                      {msg.role === "assistant" && msg.executionPlan?.length ? (
                        <ExecutionPanel plans={msg.executionPlan} isActive={false} />
                      ) : null}

                      <div
                        className={`rounded-2xl px-4 py-3 ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted/60 text-foreground rounded-bl-md"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-2 prose-code:text-primary prose-pre:bg-muted prose-pre:border prose-pre:border-border/40">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        ) : (
                          <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                        )}
                      </div>
                    </div>
                    {msg.role === "user" && (
                      <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center shrink-0 mt-1">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}

                {/* Live execution panel (while tools are running) */}
                {isLoading && currentPlans.length > 0 && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center shrink-0 mt-1">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="max-w-[85%] min-w-0">
                      <ExecutionPanel plans={currentPlans} isActive={true} />
                    </div>
                  </div>
                )}

                {/* Thinking indicator */}
                {isLoading && phase === "thinking" && currentPlans.length === 0 && !messages[messages.length - 1]?.content?.startsWith("⚠️") && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="bg-muted/60 rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Analyzing your request...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-border/40 bg-background/80 backdrop-blur-xl">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <div className="relative flex items-end gap-2">
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tell the agent what to do..."
                className="min-h-[48px] max-h-[200px] resize-none rounded-xl border-border/60 bg-muted/30 pr-12 text-sm focus-visible:ring-primary/30"
                rows={1}
              />
              <Button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isLoading}
                size="icon"
                className="absolute right-2 bottom-2 h-8 w-8 rounded-lg"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-muted-foreground">
                Lovable Agent — full backend access. Press Enter to send.
              </p>
              {isLoading && (
                <Badge variant="outline" className="text-xs animate-pulse">
                  <Activity className="w-3 h-3 mr-1" />
                  {phase === "thinking" ? "Thinking..." :
                   phase === "executing" ? "Executing tools..." :
                   phase === "generating" ? "Writing response..." :
                   "Working..."}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
