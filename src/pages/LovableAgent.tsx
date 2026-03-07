import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import ReactMarkdown from "react-markdown";
import { SteelSessionEmbed } from "@/components/chat/SteelSessionEmbed";
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

type SecretRequest = {
  secret_name: string;
  display_label: string;
  description: string;
  placeholder: string;
  status: "pending" | "submitted" | "error";
};

type BrowserLiveState = {
  runId: string;
  provider: string;
  task: string;
  status: "starting" | "running" | "completed" | "error";
  step: number;
  currentUrl: string | null;
  screenshotUrl: string | null;
  actionHistory: Array<{ step: number; action: string }>;
  error: string | null;
  result: string | null;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  executionPlan?: ExecutionPlan[];
  callState?: CallState;
  isGenerating?: boolean;
  secretRequest?: SecretRequest;
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
    request_secret: "Requesting secret from user",
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

// ── Secret Input Panel Component ────────────────────────────────────────────
function SecretInputPanel({ 
  secretRequest, 
  onSubmit 
}: { 
  secretRequest: SecretRequest; 
  onSubmit: (secretName: string, value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showValue, setShowValue] = useState(false);

  const handleSubmit = async () => {
    if (!value.trim()) return;
    setIsSubmitting(true);
    await onSubmit(secretRequest.secret_name, value.trim());
    setIsSubmitting(false);
  };

  if (secretRequest.status === "submitted") {
    return (
      <div className="my-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <span className="font-medium">{secretRequest.display_label}</span>
          <span className="text-muted-foreground">— stored securely</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Key className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{secretRequest.display_label}</div>
            <div className="text-xs text-muted-foreground">{secretRequest.description}</div>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showValue ? "text" : "password"}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={secretRequest.placeholder || "Enter secret value..."}
              className="w-full h-10 rounded-lg border border-border/60 bg-background px-3 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50"
              onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
            />
            <button
              onClick={() => setShowValue(!showValue)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              type="button"
            >
              {showValue ? <Shield className="w-4 h-4" /> : <Key className="w-4 h-4" />}
            </button>
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!value.trim() || isSubmitting}
            size="default"
            className="bg-amber-500 hover:bg-amber-600 text-white shrink-0"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            <span className="ml-1">Store</span>
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
          <Shield className="w-3 h-3" />
          Encrypted and stored securely. Never visible in logs or chat.
        </p>
      </div>
    </div>
  );
}

// ── Call Monitor Panel Component ────────────────────────────────────────────
function CallMonitorPanel({ callState, isLive }: { callState: CallState; isLive: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [callState.transcript]);

  const statusColor = callState.status === "completed" ? "text-emerald-500" :
    callState.status === "failed" || callState.status === "error" ? "text-destructive" :
    "text-primary";

  const statusLabel = callState.status === "ringing" ? "Ringing..." :
    callState.status === "running" ? `Turn ${callState.turnCount}` :
    callState.status === "completed" ? "Call Complete" :
    callState.status === "failed" ? "Call Failed" : "Error";

  return (
    <div className="my-2 rounded-xl border border-border/60 bg-card/80 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        <Phone className="w-3.5 h-3.5 text-primary" />
        <span className="text-foreground/80 font-semibold">
          Phone Call — {callState.agentName || "Maya"}
        </span>
        <span className={`ml-auto flex items-center gap-1 ${statusColor}`}>
          {isLive && callState.status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
          {isLive && callState.status === "ringing" && <Phone className="w-3 h-3 animate-pulse" />}
          {callState.status === "completed" && <CheckCircle2 className="w-3 h-3" />}
          {(callState.status === "failed" || callState.status === "error") && <PhoneOff className="w-3 h-3" />}
          {statusLabel}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3">
          {/* Live Transcript */}
          {callState.transcript.length > 0 && (
            <div ref={transcriptRef} className="max-h-64 overflow-y-auto space-y-1.5">
              {callState.transcript.map((entry, i) => {
                const isSystem = entry.content.startsWith("[SYSTEM:");
                const isAgent = entry.role === "assistant";
                const isHuman = entry.role === "user";

                if (isSystem) {
                  return (
                    <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 italic py-0.5">
                      <Shield className="w-3 h-3" />
                      {entry.content.replace(/\[SYSTEM:\s*|\]/g, "")}
                    </div>
                  );
                }

                return (
                  <div key={i} className={`flex items-start gap-2 text-xs py-1 px-2 rounded-lg ${
                    isAgent ? "bg-primary/5" : "bg-muted/40"
                  }`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      isAgent ? "bg-primary/20" : "bg-muted"
                    }`}>
                      {isAgent ? <Mic className="w-2.5 h-2.5 text-primary" /> : <User className="w-2.5 h-2.5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-[10px] uppercase tracking-wider text-muted-foreground/60">
                        {isAgent ? (callState.agentName || "Maya") : "Caller"}
                      </span>
                      <p className="text-foreground/80 leading-relaxed">{entry.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Ringing state */}
          {callState.status === "ringing" && callState.transcript.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Phone className="w-4 h-4 animate-pulse text-primary" />
              <span>Dialing... waiting for answer</span>
            </div>
          )}

          {/* Analyst Report */}
          {callState.lastAnalysis && (
            <div className="border-t border-border/30 pt-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                <Brain className="w-3 h-3" />
                Analyst Report
              </div>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
                {callState.lastAnalysis.length > 200 ? callState.lastAnalysis.slice(0, 200) + "..." : callState.lastAnalysis}
              </p>
            </div>
          )}

          {/* Director Decision */}
          {callState.lastDirective && (
            <div className="border-t border-border/30 pt-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                <MessageSquare className="w-3 h-3" />
                Director Strategy
              </div>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
                {callState.lastDirective.length > 200 ? callState.lastDirective.slice(0, 200) + "..." : callState.lastDirective}
              </p>
            </div>
          )}

          {/* Error */}
          {callState.errorMessage && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-2 py-1.5">
              {callState.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Browser Live Panel Component ────────────────────────────────────────────
function BrowserLivePanel({
  state,
  isLive,
  isCommandBusy,
  onControl,
  onInject,
}: {
  state: BrowserLiveState;
  isLive: boolean;
  isCommandBusy: boolean;
  onControl: (command: "pause" | "resume" | "stop" | "approve") => void;
  onInject: (instruction: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [imgKey, setImgKey] = useState(0);
  const [liveInstruction, setLiveInstruction] = useState("");

  // Auto-refresh screenshot key when URL changes
  useEffect(() => {
    if (state.screenshotUrl) setImgKey(k => k + 1);
  }, [state.screenshotUrl]);

  const statusColor = state.status === "completed" ? "text-emerald-500" :
    state.status === "error" ? "text-destructive" :
    "text-primary";

  const statusLabel = state.status === "starting" ? "Starting browser..." :
    state.status === "running" ? `Step ${state.step}` :
    state.status === "completed" ? "Complete" : "Error";

  return (
    <div className="my-2 rounded-xl border border-border/60 bg-card/80 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        <Globe className="w-3.5 h-3.5 text-primary" />
        <span className="text-foreground/80 font-semibold">
          Live Browser — {state.task.length > 50 ? state.task.slice(0, 50) + "…" : state.task}
        </span>
        <span className={`ml-auto flex items-center gap-1 ${statusColor}`}>
          {isLive && (state.status === "running" || state.status === "starting") && <Loader2 className="w-3 h-3 animate-spin" />}
          {state.status === "completed" && <CheckCircle2 className="w-3 h-3" />}
          {statusLabel}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-0">
          {/* Live Screenshot */}
          {state.screenshotUrl && (
            <div className="relative border-t border-border/30">
              <img
                key={imgKey}
                src={state.screenshotUrl}
                alt="Live browser view"
                className="w-full max-h-[400px] object-contain bg-black/5"
                loading="eager"
              />
              {isLive && (state.status === "running" || state.status === "starting") && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-background/80 backdrop-blur-sm rounded-full px-2 py-0.5 text-[10px] text-primary border border-border/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  LIVE
                </div>
              )}
            </div>
          )}

          {/* Current URL bar */}
          {state.currentUrl && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border/30 bg-muted/40">
              <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] text-muted-foreground truncate font-mono">{state.currentUrl}</span>
            </div>
          )}

          {/* Action history */}
          {state.actionHistory.length > 0 && (
            <div className="px-3 py-2 border-t border-border/30 space-y-1">
              {state.actionHistory.slice(-20).map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <span className="shrink-0 font-mono text-muted-foreground/50">#{a.step}</span>
                  <span className="break-words">{String(a.action)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Operator controls */}
          {(state.status === "running" || state.status === "starting") && (
            <div className="px-3 py-2 border-t border-border/30 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="secondary" disabled={isCommandBusy} onClick={() => onControl("pause")}>Pause</Button>
                <Button size="sm" variant="secondary" disabled={isCommandBusy} onClick={() => onControl("resume")}>Resume</Button>
                <Button size="sm" variant="outline" disabled={isCommandBusy} onClick={() => onControl("approve")}>Approve Next Risky Step</Button>
                <Button size="sm" variant="destructive" disabled={isCommandBusy} onClick={() => onControl("stop")}>Stop</Button>
              </div>
              <div className="flex items-center gap-2">
                <Textarea
                  value={liveInstruction}
                  onChange={(e) => setLiveInstruction(e.target.value)}
                  placeholder="Live direction: e.g. Skip LinkedIn and switch to Indeed, remote only, max salary filter..."
                  className="min-h-[56px]"
                />
                <Button
                  disabled={isCommandBusy || !liveInstruction.trim()}
                  onClick={() => {
                    const next = liveInstruction.trim();
                    if (!next) return;
                    onInject(next);
                    setLiveInstruction("");
                  }}
                >
                  Send Direction
                </Button>
              </div>
            </div>
          )}

          {/* No screenshot yet */}
          {!state.screenshotUrl && (state.status === "starting" || state.status === "running") && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground border-t border-border/30">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>{state.step > 0 ? `Executing browser actions (step ${state.step})...` : "Waiting for browser to start..."}</span>
            </div>
          )}

          {/* Error */}
          {state.error && (
            <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-t border-border/30">
              {state.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Steel Embed + Screenshot Parser ──────────────────────────────────────────
interface SteelEmbedData {
  debugUrl: string;
  sessionId?: string;
  interactive?: boolean;
}

interface ScreenshotData {
  url: string;
  alt?: string;
}

function parseSteelEmbeds(content: string): { text: string; embeds: SteelEmbedData[]; screenshots: ScreenshotData[] } {
  const embeds: SteelEmbedData[] = [];
  const screenshots: ScreenshotData[] = [];
  const embedRegex = /\[STEEL_EMBED\]([\s\S]*?)\[\/STEEL_EMBED\]/g;
  let text = content;
  let match;

  while ((match = embedRegex.exec(content)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      if (data.debugUrl) embeds.push(data);
    } catch { /* ignore */ }
    text = text.replace(match[0], "");
  }

  const urlRegex = /https:\/\/[^\s"]+\.steel\.dev[^\s"]*/g;
  const urls = content.match(urlRegex) || [];
  for (const url of urls) {
    if (!embeds.some((e) => e.debugUrl === url)) {
      embeds.push({ debugUrl: url, interactive: false });
    }
  }

  // Extract bridge screenshot URLs
  const screenshotRegex = /📸\s*Screenshot:\s*(https?:\/\/[^\s"]+\/runs\/[^\s"]+\/screenshot)/g;
  let ssMatch;
  while ((ssMatch = screenshotRegex.exec(content)) !== null) {
    screenshots.push({ url: ssMatch[1], alt: "Browser screenshot" });
    text = text.replace(ssMatch[0], "");
  }

  // Also catch raw screenshot URLs in markdown image syntax
  const mdImgRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s"]+\/runs\/[^\s"]+\/screenshot)\)/g;
  while ((ssMatch = mdImgRegex.exec(content)) !== null) {
    screenshots.push({ url: ssMatch[2], alt: ssMatch[1] || "Browser screenshot" });
  }

  return { text: text.trim(), embeds, screenshots };
}

// ── Lovable Message Content (with Steel embeds) ─────────────────────────────
function LovableMessageContent({ content, role }: { content: string; role: "user" | "assistant" }) {
  const { text, embeds, screenshots } = useMemo(() =>
    role === "assistant" ? parseSteelEmbeds(content) : { text: content, embeds: [] as SteelEmbedData[], screenshots: [] as ScreenshotData[] },
    [content, role]
  );

  return (
    <>
      <div
        className={`rounded-2xl px-4 py-3 ${
          role === "user"
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted/60 text-foreground rounded-bl-md"
        }`}
      >
        {role === "assistant" ? (
          <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-2 prose-code:text-primary prose-pre:bg-muted prose-pre:border prose-pre:border-border/40">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        ) : (
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{text}</div>
        )}
      </div>
      {embeds.map((embed, i) => (
        <SteelSessionEmbed
          key={`${embed.debugUrl}-${i}`}
          debugUrl={embed.debugUrl}
          sessionId={embed.sessionId}
          interactive={embed.interactive}
        />
      ))}
      {screenshots.map((ss, i) => (
        <div key={`ss-${i}`} className="mt-2 rounded-lg overflow-hidden border border-border/40 bg-muted/30">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 border-b border-border/30">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">Browser Screenshot</span>
            <a href={ss.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-primary hover:underline">Open</a>
          </div>
          <img src={ss.url} alt={ss.alt || "Screenshot"} className="w-full max-h-96 object-contain" loading="lazy" />
        </div>
      ))}
    </>
  );
}

// ── Suggestions ─────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: Sparkles, text: "Run the full mission and complete each section", color: "text-emerald-400" },
  { icon: Search, text: "Find a product and add it to cart with click-by-click updates", color: "text-cyan-400" },
  { icon: Code2, text: "Optimize my resume for more interviews", color: "text-rose-400" },
  { icon: Search, text: "Find jobs matching my preferences", color: "text-sky-400" },
  { icon: FileText, text: "Check my application status", color: "text-amber-400" },
  { icon: Paintbrush, text: "Help me improve the app design", color: "text-violet-400" },
  { icon: Heart, text: "Act like phone + browser copilot and keep me on course", color: "text-pink-400" },
];

// ── Main Page ───────────────────────────────────────────────────────────────
export default function LovableAgent() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentPlans, setCurrentPlans] = useState<ExecutionPlan[]>([]);
  const [currentCallState, setCurrentCallState] = useState<CallState | null>(null);
  const callStateRef = useRef<CallState | null>(null);
  const [browserLiveState, setBrowserLiveState] = useState<BrowserLiveState | null>(null);
  const browserLiveRef = useRef<BrowserLiveState | null>(null);
  const browserPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserUrlsRef = useRef<{ statusUrl: string; screenshotUrl: string } | null>(null);
  const [browserCommandBusy, setBrowserCommandBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "thinking" | "executing" | "generating" | "on_call" | "browsing">("idle");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentPlans, phase, browserLiveState]);

  // ── Persistent client-side polling for browser tasks ──────────────────────
  // Kicks in when SSE stream ends but browser task is still running
  const clientStuckCountRef = useRef(0);
  const CLIENT_STUCK_LIMIT = 60; // 60 polls × 5s = 5min — be patient, no cloud fallback

  useEffect(() => {
    // Only start persistent polling when NOT loading (SSE ended) and browser is still active
    if (isLoading || !browserLiveState) return;
    if (browserLiveState.status === "completed" || browserLiveState.status === "error") return;
    if (!browserUrlsRef.current) return;

    const { statusUrl, screenshotUrl } = browserUrlsRef.current;
    console.log("[BrowserPoll] Starting persistent client-side polling:", statusUrl);
    clientStuckCountRef.current = 0;

    const stopPolling = () => {
      if (browserPollRef.current) {
        clearInterval(browserPollRef.current);
        browserPollRef.current = null;
      }
    };

    const poll = async () => {
      try {
        const res = await fetch(statusUrl);
        if (!res.ok) {
          clientStuckCountRef.current++;
          if (clientStuckCountRef.current >= CLIENT_STUCK_LIMIT) {
            console.warn("[BrowserPoll] Bridge unreachable for too long. Stopping.");
            setBrowserLiveState(prev => prev ? { ...prev, status: "error", error: "Lost connection to browser server." } : prev);
            stopPolling();
          }
          return;
        }
        const data = await res.json();
        const step = data.steps_taken || data.current_step || 0;

        if (data.status === "completed") {
          setBrowserLiveState(prev => prev ? {
            ...prev, status: "completed", step: data.steps_taken || prev.step,
            currentUrl: data.current_url || prev.currentUrl,
            screenshotUrl: data.has_screenshot ? `${screenshotUrl}?t=${Date.now()}` : prev.screenshotUrl,
            result: data.result || null,
          } : prev);
          browserLiveRef.current = null;
          stopPolling();
        } else if (data.status === "error") {
          setBrowserLiveState(prev => prev ? { ...prev, status: "error", error: data.error || "Task failed" } : prev);
          stopPolling();
        } else {
          // Check if stuck at step 0
          if (step === 0 && (data.status === "starting" || data.status === "queued")) {
            clientStuckCountRef.current++;
            if (clientStuckCountRef.current >= CLIENT_STUCK_LIMIT) {
              console.warn("[BrowserPoll] Browser stuck at step 0 for too long. Giving up.");
              setBrowserLiveState(prev => prev ? { ...prev, status: "error", error: "Browser task stuck — server may be cold-starting. Try again in a minute." } : prev);
              stopPolling();
              return;
            }
          } else {
            clientStuckCountRef.current = 0;
          }
          // Still running — update progress
          setBrowserLiveState(prev => prev ? {
            ...prev,
            status: step > 0 ? "running" : prev.status,
            step,
            currentUrl: data.current_url || prev.currentUrl,
            screenshotUrl: data.has_screenshot ? `${screenshotUrl}?t=${Date.now()}` : prev.screenshotUrl,
            actionHistory: data.action_history?.slice(-5)?.map((a: any, i: number) => ({
              step: a.step || step - (data.action_history.length - 1 - i),
              action: typeof a === "string" ? a : a.action || JSON.stringify(a),
            })) || prev.actionHistory,
          } : prev);
        }
      } catch (err) {
        console.warn("[BrowserPoll] Poll error:", err);
        clientStuckCountRef.current++;
        if (clientStuckCountRef.current >= CLIENT_STUCK_LIMIT) {
          setBrowserLiveState(prev => prev ? { ...prev, status: "error", error: "Lost connection to browser server." } : prev);
          stopPolling();
        }
      }
    };

    // Poll immediately, then every 5 seconds
    poll();
    browserPollRef.current = setInterval(poll, 5000);

    return () => { stopPolling(); };
  }, [isLoading, browserLiveState?.status]);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isLoading || !session?.access_token) return;

    const userMsg: Msg = { role: "user", content: msg };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    setPhase("thinking");
    setCurrentPlans([]);
    setCurrentCallState(null);
    callStateRef.current = null;
    // Clear previous browser state and stop any persistent polling
    setBrowserLiveState(null);
    browserLiveRef.current = null;
    browserUrlsRef.current = null;
    if (browserPollRef.current) {
      clearInterval(browserPollRef.current);
      browserPollRef.current = null;
    }
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

      // Attach execution plans and call state to the final message
      // Use callStateRef to get the latest value (avoids stale closure)
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1
            ? { ...m, executionPlan: currentPlans.length ? [...currentPlans] : undefined, callState: callStateRef.current || undefined, isGenerating: false }
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

      case "call_started": {
        setPhase("on_call");
        const initial: CallState = {
          taskId: data.taskId,
          status: "ringing",
          turnCount: 0,
          transcript: [],
          lastAnalysis: null,
          lastDirective: null,
          agentName: "Maya",
          errorMessage: null,
          recordingUrl: null,
        };
        setCurrentCallState(initial);
        callStateRef.current = initial;
        break;
      }

      case "call_update":
        setCurrentCallState(prev => {
          const updated = prev ? {
            ...prev,
            status: (data.status === "completed" || data.status === "failed" ? data.status : "running") as CallState["status"],
            turnCount: data.turnCount || prev.turnCount,
            transcript: data.transcript || prev.transcript,
            lastAnalysis: data.lastAnalysis ? (typeof data.lastAnalysis === 'string' ? data.lastAnalysis : JSON.stringify(data.lastAnalysis)) : prev.lastAnalysis,
            lastDirective: data.lastDirective ? (typeof data.lastDirective === 'string' ? data.lastDirective : JSON.stringify(data.lastDirective)) : prev.lastDirective,
            agentName: data.agentName || prev.agentName,
          } : prev;
          callStateRef.current = updated;
          return updated;
        });
        break;

      case "call_ended": {
        // Build transcript summary for chat history
        const endedTranscript = data.transcript || callStateRef.current?.transcript || [];
        const transcriptSummary = endedTranscript.length > 0
          ? endedTranscript.map((t: CallTranscriptEntry) => `**${t.role === "assistant" ? "Maya" : "Them"}**: ${t.content}`).join("\n")
          : "No transcript available.";
        const callStatus = data.status === "completed" ? "✅ Call completed" : "❌ Call failed";

        // Append transcript to chat so the agent has context for follow-ups
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: `${callStatus} (${data.turnCount || callStateRef.current?.turnCount || 0} turns)\n\n<details>\n<summary>📞 Full Call Transcript</summary>\n\n${transcriptSummary}\n</details>${data.errorMessage ? `\n\n⚠️ ${data.errorMessage}` : ""}` },
        ]);

        setCurrentCallState(prev => {
          const updated = prev ? {
            ...prev,
            status: (data.status as "completed" | "failed"),
            turnCount: data.turnCount || prev.turnCount,
            transcript: data.transcript || prev.transcript,
            lastAnalysis: data.lastAnalysis ? (typeof data.lastAnalysis === 'string' ? data.lastAnalysis : JSON.stringify(data.lastAnalysis)) : prev.lastAnalysis,
            errorMessage: data.errorMessage || null,
            recordingUrl: data.recordingUrl || null,
          } : prev;
          callStateRef.current = updated;
          return updated;
        });
        setPhase("generating");
        break;
      }

      case "call_retry": {
        // A retry is starting — notify user and reset call state for new attempt
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: `🔄 **Auto-retry**: ${data.message}\n\n_${data.remainingStores} more store(s) in queue_` },
        ]);
        const retryInitial: CallState = {
          taskId: "",
          status: "ringing",
          turnCount: 0,
          transcript: [],
          lastAnalysis: null,
          lastDirective: null,
          agentName: "Maya",
          errorMessage: null,
          recordingUrl: null,
        };
        setCurrentCallState(retryInitial);
        callStateRef.current = retryInitial;
        setPhase("on_call");
        break;
      }

      case "call_retry_failed":
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: `⚠️ Retry to **${data.storeName}** failed: ${data.error}` },
        ]);
        break;

      case "call_all_retries_exhausted":
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: `❌ **All stores exhausted** — tried ${data.storesTried?.length || 0} stores, none succeeded. ${data.message}` },
        ]);
        setPhase("generating");
        break;

      case "phase":
        if (data.status === "generating") setPhase("generating");
        break;

      case "secret_request":
        // Add a message with a secret input panel
        setMessages(prev => [
          ...prev,
          {
            role: "assistant",
            content: "",
            secretRequest: {
              secret_name: data.secret_name,
              display_label: data.display_label,
              description: data.description || "",
              placeholder: data.placeholder || "",
              status: "pending",
            },
          },
        ]);
        break;

      case "browser_started": {
        setPhase("browsing");
        // Capture polling URLs for persistent client-side polling after SSE ends
        if (data.statusUrl && data.screenshotUrl) {
          browserUrlsRef.current = { statusUrl: data.statusUrl, screenshotUrl: data.screenshotUrl };
        }
        const initial: BrowserLiveState = {
          runId: data.runId,
          provider: data.provider || "self_hosted_bridge",
          task: data.task || "",
          status: "starting",
          step: 0,
          currentUrl: null,
          screenshotUrl: null,
          actionHistory: [],
          error: null,
          result: null,
        };
        setBrowserLiveState(initial);
        browserLiveRef.current = initial;
        break;
      }

      case "browser_progress": {
        setBrowserLiveState(prev => {
          const updated: BrowserLiveState = prev ? {
            ...prev,
            status: "running",
            step: data.step || prev.step,
            currentUrl: data.currentUrl || prev.currentUrl,
            screenshotUrl: data.screenshotUrl || data.stepScreenshotUrl || prev.screenshotUrl,
            actionHistory: data.actionHistory?.length ? data.actionHistory : prev.actionHistory,
          } : {
            runId: data.runId,
            provider: "self_hosted_bridge",
            task: "",
            status: "running",
            step: data.step || 0,
            currentUrl: data.currentUrl || null,
            screenshotUrl: data.screenshotUrl || null,
            actionHistory: data.actionHistory || [],
            error: null,
            result: null,
          };
          browserLiveRef.current = updated;
          return updated;
        });
        break;
      }

      case "browser_completed": {
        setBrowserLiveState(prev => {
          const updated: BrowserLiveState = prev ? {
            ...prev,
            status: "completed",
            step: data.stepsTaken || prev.step,
            currentUrl: data.currentUrl || prev.currentUrl,
            screenshotUrl: data.screenshotUrl || prev.screenshotUrl,
            result: data.result || null,
          } : null as any;
          browserLiveRef.current = updated;
          return updated;
        });
        setPhase("executing");
        break;
      }

      case "browser_error": {
        const rawError = String(data.error || "Unknown error");
        const isCloudFallbackSignal = /switching to cloud provider|falling back to browser use cloud/i.test(rawError);

        if (isCloudFallbackSignal) {
          // Defensive guard: never surface cloud failover; keep bridge session alive and continue polling.
          setBrowserLiveState(prev => {
            if (!prev) return prev;
            const updated: BrowserLiveState = {
              ...prev,
              status: prev.status === "running" ? "running" : "starting",
              error: null,
            };
            browserLiveRef.current = updated;
            return updated;
          });
          setPhase("browsing");
          break;
        }

        setBrowserLiveState(prev => {
          const updated: BrowserLiveState = prev ? {
            ...prev,
            status: "error",
            error: rawError,
          } : null as any;
          browserLiveRef.current = updated;
          return updated;
        });
        setPhase("executing");
        break;
      }

      case "error":
        console.error("[agent event] Error:", data.message);
        break;
    }
  }, []);

  const sendBrowserControl = useCallback(async (command: "pause" | "resume" | "stop" | "approve") => {
    if (!session?.access_token || !browserLiveRef.current?.runId) return;
    try {
      setBrowserCommandBusy(true);
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/browser-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: "control",
          run_id: browserLiveRef.current.runId,
          command,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.error) {
        throw new Error(data?.error || `control failed (${resp.status})`);
      }

      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `🕹️ Control sent: **${command.toUpperCase()}**` },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `⚠️ Failed to send control command: ${err?.message || "Unknown error"}` },
      ]);
    } finally {
      setBrowserCommandBusy(false);
    }
  }, [session?.access_token]);

  const injectBrowserDirection = useCallback(async (instruction: string) => {
    if (!session?.access_token || !browserLiveRef.current?.runId || !instruction.trim()) return;
    try {
      setBrowserCommandBusy(true);
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/browser-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: "inject",
          run_id: browserLiveRef.current.runId,
          target: "browser_agent",
          instruction: instruction.trim(),
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.error) {
        throw new Error(data?.error || `inject failed (${resp.status})`);
      }

      setMessages(prev => [
        ...prev,
        { role: "user", content: `Live direction: ${instruction.trim()}` },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `⚠️ Failed to send live direction: ${err?.message || "Unknown error"}` },
      ]);
    } finally {
      setBrowserCommandBusy(false);
    }
  }, [session?.access_token]);

  // ── Secret Submission ─────────────────────────────────────────────────────
  const submitSecret = useCallback(async (secretName: string, secretValue: string) => {
    if (!session?.access_token) return;

    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lovable-agent?action=store_secret`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ secret_name: secretName, secret_value: secretValue }),
        }
      );

      const data = await resp.json();
      if (data.success) {
        // Update the message's secretRequest status to "submitted"
        setMessages(prev =>
          prev.map(m =>
            m.secretRequest?.secret_name === secretName
              ? { ...m, secretRequest: { ...m.secretRequest, status: "submitted" as const } }
              : m
          )
        );
      } else {
        setMessages(prev =>
          prev.map(m =>
            m.secretRequest?.secret_name === secretName
              ? { ...m, secretRequest: { ...m.secretRequest, status: "error" as const } }
              : m
          )
        );
      }
    } catch (e) {
      console.error("[submitSecret]", e);
    }
  }, [session]);

  // ── Operator Injection (mid-call instructions) ───────────────────────────
  const [isInjecting, setIsInjecting] = useState(false);

  const injectInstruction = useCallback(async () => {
    const instruction = input.trim();
    const taskId = callStateRef.current?.taskId;
    if (!instruction || !taskId || !session?.access_token) return;

    setIsInjecting(true);
    setInput("");

    // Show the injection in chat
    setMessages(prev => [
      ...prev,
      { role: "user", content: `🎙️ **Operator injection:** ${instruction}` },
    ]);

    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-agent?action=inject`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ task_id: taskId, instruction }),
        }
      );

      const data = await resp.json();
      if (data.success) {
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: `✅ Instruction injected — will be applied on Maya's next turn. (${data.pendingInjections} pending)` },
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: `⚠️ Injection failed: ${data.error || "Unknown error"}` },
        ]);
      }
    } catch (e: any) {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `⚠️ Injection error: ${e.message}` },
      ]);
    } finally {
      setIsInjecting(false);
    }
  }, [input, session]);

  const isOnCall = phase === "on_call";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isOnCall) {
        injectInstruction();
      } else {
        sendMessage();
      }
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

                      {/* Call monitor panel (after execution, before content) */}
                      {msg.role === "assistant" && msg.callState ? (
                        <CallMonitorPanel callState={msg.callState} isLive={false} />
                      ) : null}

                      {/* Secret input panel */}
                      {msg.role === "assistant" && msg.secretRequest ? (
                        <SecretInputPanel secretRequest={msg.secretRequest} onSubmit={submitSecret} />
                      ) : null}

                      <LovableMessageContent content={msg.content} role={msg.role} />
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

                {/* Live browser panel — persists after SSE ends for ongoing tasks */}
                {browserLiveState && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center shrink-0 mt-1">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="max-w-[85%] min-w-0 w-full">
                      <BrowserLivePanel
                        state={browserLiveState}
                        isLive={browserLiveState.status === "running" || browserLiveState.status === "starting"}
                        isCommandBusy={browserCommandBusy}
                        onControl={sendBrowserControl}
                        onInject={injectBrowserDirection}
                      />
                      {!isLoading && (browserLiveState.status === "running" || browserLiveState.status === "starting") && (
                        <div className="flex items-center gap-2 mt-1.5 px-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-[11px] text-muted-foreground">Persistent monitoring active — polling every 5s</span>
                          <button
                            onClick={() => { setBrowserLiveState(null); browserUrlsRef.current = null; }}
                            className="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {isLoading && currentCallState && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center shrink-0 mt-1">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="max-w-[85%] min-w-0">
                      <CallMonitorPanel callState={currentCallState} isLive={true} />
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
                placeholder={isOnCall ? "Inject instruction to Maya mid-call..." : "Tell the agent what to do..."}
                className={`min-h-[48px] max-h-[200px] resize-none rounded-xl pr-12 text-sm focus-visible:ring-primary/30 ${isOnCall ? "border-orange-500/60 bg-orange-500/5" : "border-border/60 bg-muted/30"}`}
                rows={1}
              />
              <Button
                onClick={() => isOnCall ? injectInstruction() : sendMessage()}
                disabled={!input.trim() || (isLoading && !isOnCall) || isInjecting}
                size="icon"
                className={`absolute right-2 bottom-2 h-8 w-8 rounded-lg ${isOnCall ? "bg-orange-500 hover:bg-orange-600" : ""}`}
              >
                {isInjecting ? <Loader2 className="w-4 h-4 animate-spin" /> : isOnCall ? <Mic className="w-4 h-4" /> : isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-muted-foreground">
                Lovable Agent — full backend access. Press Enter to send.
              </p>
              {isLoading && (
                <Badge variant="outline" className="text-xs animate-pulse">
                  {phase === "on_call" ? <Phone className="w-3 h-3 mr-1" /> : <Activity className="w-3 h-3 mr-1" />}
                  {phase === "thinking" ? "Thinking..." :
                   phase === "executing" ? "Executing tools..." :
                   phase === "on_call" ? "On call..." :
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
