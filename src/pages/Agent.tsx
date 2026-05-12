import { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { VMViewer } from "@/components/agent/VMViewer";
import { VMCommandOutput } from "@/components/agent/VMCommandOutput";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  Briefcase,
  FileText,
  ShoppingCart,
  Search,
  Mail,
  Activity,
  User,
  Zap,
  Monitor,
  PhoneCall,
  MessageSquare,
  Mic,
  PhoneOff,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

type Msg = { role: "user" | "assistant"; content: string };

type VoiceOpsCall = {
  id: string;
  phone_number: string;
  objective: string;
  status: string;
  outcome: string | null;
  ended_reason: string | null;
  recording_url: string | null;
  duration_seconds: number | null;
  created_at: string;
};

type VoiceOpsTurn = {
  id: string;
  role: string;
  text: string;
  is_final: boolean;
  created_at: string;
};

const ACTIVE_CALL_STATUSES = new Set(["queued", "starting", "ringing", "in-progress", "active"]);

interface VMStreamInfo {
  vm_id: string;
  name: string;
  noVNC_url: string | null;
}

const SUGGESTIONS = [
  { icon: Briefcase, text: "Find me matching jobs", color: "text-blue-400" },
  { icon: FileText, text: "Optimize my resume", color: "text-green-400" },
  { icon: Monitor, text: "Run a task on my VM", color: "text-orange-400" },
  { icon: Activity, text: "Check my pipeline status", color: "text-yellow-400" },
  { icon: Mail, text: "Check for recruiter emails", color: "text-purple-400" },
  { icon: Search, text: "Research average salaries for my target roles", color: "text-cyan-400" },
];

// Parse __VM_STREAM__{...} markers from assistant messages
function parseVMStream(content: string): { cleanContent: string; vmInfo: VMStreamInfo | null } {
  const match = content.match(/__VM_STREAM__(\{[^}]+\})/);
  if (!match) return { cleanContent: content, vmInfo: null };

  try {
    const vmInfo = JSON.parse(match[1]) as VMStreamInfo;
    const cleanContent = content.replace(/__VM_STREAM__\{[^}]+\}/, "").trim();
    return { cleanContent, vmInfo };
  } catch {
    return { cleanContent: content, vmInfo: null };
  }
}

function parseVoiceOpsCallId(content: string): string | null {
  const marker = content.match(/__VOICEOPS_CALL__(\{[\s\S]*?\})__END_VOICEOPS_CALL__/);
  if (marker?.[1]) {
    try {
      const parsed = JSON.parse(marker[1]);
      if (parsed?.call_id) return parsed.call_id;
    } catch { /* ignore malformed marker */ }
  }

  const patterns = [
    /call_id=["']([0-9a-f-]{36})["']/i,
    /call_id["'`:\s=]+([0-9a-f-]{36})/i,
    /"call_id"\s*:\s*"([0-9a-f-]{36})"/i,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function cleanAssistantContent(content: string) {
  return parseVMStream(content).cleanContent
    .replace(/__VOICEOPS_CALL__\{[\s\S]*?\}__END_VOICEOPS_CALL__/g, "")
    .trim();
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Parse VM command output blocks from content
function parseVMCommands(content: string): Array<{ type: "text"; value: string } | { type: "vm_cmd"; command: string; output: string; exitCode?: number; vmName: string; durationMs?: number }> {
  // Look for patterns like ```powershell\nPS> command\n```  followed by output
  // Or structured JSON vm output markers
  const vmOutputMatch = content.match(/__VM_OUTPUT__(\{[\s\S]*?\})__END_VM_OUTPUT__/g);
  if (!vmOutputMatch) return [{ type: "text", value: content }];

  const parts: Array<{ type: "text"; value: string } | { type: "vm_cmd"; command: string; output: string; exitCode?: number; vmName: string; durationMs?: number }> = [];
  let remaining = content;

  for (const match of vmOutputMatch) {
    const idx = remaining.indexOf(match);
    if (idx > 0) {
      parts.push({ type: "text", value: remaining.slice(0, idx).trim() });
    }
    try {
      const json = JSON.parse(match.replace("__VM_OUTPUT__", "").replace("__END_VM_OUTPUT__", ""));
      parts.push({ type: "vm_cmd", ...json });
    } catch {
      parts.push({ type: "text", value: match });
    }
    remaining = remaining.slice(idx + match.length);
  }

  if (remaining.trim()) {
    parts.push({ type: "text", value: remaining.trim() });
  }

  return parts;
}

export default function Agent() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeVM, setActiveVM] = useState<VMStreamInfo | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<VoiceOpsCall | null>(null);
  const [callTurns, setCallTurns] = useState<VoiceOpsTurn[]>([]);
  const [injectionText, setInjectionText] = useState("");
  const [isInjecting, setIsInjecting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeVM, activeCallId, callTurns]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [callTurns]);

  useEffect(() => {
    if (!activeCallId) {
      setActiveCall(null);
      setCallTurns([]);
      return;
    }

    let cancelled = false;
    const loadCall = async () => {
      const { data: call } = await supabase
        .from("voiceops_calls")
        .select("id, phone_number, objective, status, outcome, ended_reason, recording_url, duration_seconds, created_at")
        .eq("id", activeCallId)
        .maybeSingle();
      if (!cancelled) setActiveCall(call as VoiceOpsCall | null);
    };
    const loadTurns = async () => {
      const { data } = await supabase
        .from("voiceops_transcripts")
        .select("id, role, text, is_final, created_at")
        .eq("call_id", activeCallId)
        .order("created_at", { ascending: true });
      if (!cancelled) setCallTurns((data ?? []) as VoiceOpsTurn[]);
    };

    loadCall();
    loadTurns();

    const callChannel = supabase
      .channel(`manus-voiceops-call-${activeCallId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voiceops_calls", filter: `id=eq.${activeCallId}` },
        (payload) => setActiveCall(payload.new as VoiceOpsCall),
      )
      .subscribe();

    const turnsChannel = supabase
      .channel(`manus-voiceops-turns-${activeCallId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "voiceops_transcripts", filter: `call_id=eq.${activeCallId}` },
        (payload) => setCallTurns((prev) => [...prev, payload.new as VoiceOpsTurn]),
      )
      .subscribe();

    const poll = setInterval(() => {
      loadCall();
      loadTurns();
    }, 3000);

    return () => {
      cancelled = true;
      supabase.removeChannel(callChannel);
      supabase.removeChannel(turnsChannel);
      clearInterval(poll);
    };
  }, [activeCallId]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isLoading || !session?.access_token) return;

    const userMsg: Msg = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    let assistantSoFar = "";

    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;

      // Check for VM stream markers
      const { vmInfo } = parseVMStream(assistantSoFar);
      if (vmInfo && vmInfo.noVNC_url) {
        setActiveVM(vmInfo);
      }

      const callId = parseVoiceOpsCallId(assistantSoFar);
      if (callId) {
        setActiveCallId(callId);
      }

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`;
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          stream: true,
        }),
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
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

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
        upsertAssistant("I processed your request. Check the relevant section of the app for results.");
      }
    } catch (e: any) {
      console.error("[Agent]", e);
      upsertAssistant(`⚠️ Error: ${e.message || "Something went wrong. Try again."}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const injectIntoCall = async (mode: "context" | "say-now" | "end-call") => {
    if (!activeCallId || isInjecting) return;
    const text = mode === "end-call" ? "end" : injectionText.trim();
    if (mode !== "end-call" && !text) return;

    setIsInjecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("voiceops-inject", {
        body: { call_id: activeCallId, text, mode },
      });
      if (error || (data as any)?.error) {
        throw new Error(error?.message || (data as any)?.error || "Injection failed");
      }
      setInjectionText("");
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ Injection failed: ${e.message || "try again"}` }]);
    } finally {
      setIsInjecting(false);
    }
  };

  const renderMessageContent = (content: string) => {
    const cleanContent = cleanAssistantContent(content);
    return (
      <div className="text-sm leading-relaxed prose prose-sm prose-invert max-w-none">
        <ReactMarkdown>{cleanContent}</ReactMarkdown>
      </div>
    );
  };

  const renderCallMonitor = () => {
    if (!activeCallId) return null;
    const isLive = !!activeCall && ACTIVE_CALL_STATUSES.has(activeCall.status);

    return (
      <div className="ml-11 rounded-xl border border-border/60 bg-card/70 shadow-lg shadow-background/20 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border/50 bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <PhoneCall className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Live call</span>
              <Badge variant={isLive ? "default" : "outline"} className="text-[11px] capitalize">
                {activeCall?.status ?? "connecting"}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {activeCall?.phone_number ?? "Dialing..."} · {activeCall?.objective ?? "Waiting for call details"}
            </p>
          </div>
          {activeCall?.recording_url && (
            <a className="text-xs text-primary hover:underline" href={activeCall.recording_url} target="_blank" rel="noreferrer">
              Recording
            </a>
          )}
        </div>

        <div ref={transcriptRef} className="max-h-72 space-y-3 overflow-y-auto p-3">
          {callTurns.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Waiting for transcript...
            </div>
          ) : (
            callTurns.map((turn) => (
              <div key={turn.id} className="rounded-lg border border-border/40 bg-background/50 p-3">
                <div className="mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3" />
                    {turn.role === "assistant" ? "Alex" : turn.role}
                  </span>
                  <span>{fmtTime(turn.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{turn.text}</p>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border/50 bg-muted/20 p-3">
          <Textarea
            value={injectionText}
            onChange={(e) => setInjectionText(e.target.value)}
            placeholder={isLive ? "Director instruction for this call..." : "Injection unlocks when the call is live"}
            disabled={!isLive || isInjecting}
            className="min-h-[72px] resize-none bg-background/70 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!isLive || isInjecting || !injectionText.trim()} onClick={() => injectIntoCall("context")}>
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              Steer
            </Button>
            <Button size="sm" variant="outline" disabled={!isLive || isInjecting || !injectionText.trim()} onClick={() => injectIntoCall("say-now")}>
              <Mic className="mr-1.5 h-3.5 w-3.5" />
              Say now
            </Button>
            <Button size="sm" variant="destructive" disabled={!isLive || isInjecting} onClick={() => injectIntoCall("end-call")}>
              <PhoneOff className="mr-1.5 h-3.5 w-3.5" />
              End
            </Button>
          </div>
          {activeCall?.ended_reason && <p className="mt-2 text-xs text-muted-foreground">Ended: {activeCall.ended_reason}</p>}
        </div>
      </div>
    );
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
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary via-accent to-primary/60 flex items-center justify-center shadow-2xl shadow-primary/30">
                    <Sparkles className="w-10 h-10 text-white" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-green-500 border-4 border-background flex items-center justify-center">
                    <Zap className="w-3 h-3 text-white" />
                  </div>
                </div>

                <div className="text-center space-y-2">
                  <h1 className="text-3xl font-display font-bold">Manus Agent</h1>
                  <p className="text-muted-foreground text-lg max-w-md">
                    Your autonomous AI agent with full access to job search, resume optimization, shopping, email monitoring, web research, and <strong>your Windows VMs</strong>.
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
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0 mt-1">
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted/60 text-foreground rounded-bl-md"
                      }`}
                    >
                      {msg.role === "assistant"
                        ? renderMessageContent(msg.content)
                        : <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                      }
                    </div>
                    {msg.role === "user" && (
                      <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center shrink-0 mt-1">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}

                {/* Inline VM Viewer */}
                {activeVM && (
                  <div className="my-4">
                    <VMViewer
                      vmName={activeVM.name}
                      noVNCUrl={activeVM.noVNC_url}
                      status="online"
                      onClose={() => setActiveVM(null)}
                    />
                  </div>
                )}

                {isLoading && !messages[messages.length - 1]?.content && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="bg-muted/60 rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Thinking & executing tools...</span>
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
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tell Manus what to do..."
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
                Manus has full access to your VMs & automations. Press Enter to send.
              </p>
              {isLoading && (
                <Badge variant="outline" className="text-xs animate-pulse">
                  <Activity className="w-3 h-3 mr-1" />
                  Agent working...
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
