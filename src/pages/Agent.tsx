import { useState, useRef, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SteelSessionEmbed } from "@/components/chat/SteelSessionEmbed";
import { VoiceRelayAgent } from "@/components/voice/VoiceRelayAgent";
import { useAuth } from "@/hooks/useAuth";
import {
  Bot, Send, Loader2, Sparkles, Briefcase, FileText,
  Search, Mail, Activity, User, Zap, Mic,
} from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

interface SteelEmbedData {
  debugUrl: string;
  sessionId?: string;
  interactive?: boolean;
}

const SUGGESTIONS = [
  { icon: Briefcase, text: "Find me matching jobs", color: "text-blue-400" },
  { icon: FileText, text: "Optimize my resume", color: "text-green-400" },
  { icon: Activity, text: "Check my pipeline status", color: "text-yellow-400" },
  { icon: Mail, text: "Check for recruiter emails", color: "text-purple-400" },
  { icon: Sparkles, text: "Give me turn-by-turn direction and reroute if needed", color: "text-pink-400" },
  { icon: Search, text: "Research average salaries for my target roles", color: "text-cyan-400" },
];

/** Extract browser embed JSON blocks from assistant messages */
function parseBrowserEmbeds(content: string): { text: string; embeds: SteelEmbedData[] } {
  const embeds: SteelEmbedData[] = [];
  // Match [BROWSER_EMBED] or legacy [STEEL_EMBED] blocks
  const embedRegex = /\[(BROWSER_EMBED|STEEL_EMBED)\]([\s\S]*?)\[\/(BROWSER_EMBED|STEEL_EMBED)\]/g;
  let text = content;
  let match;

  while ((match = embedRegex.exec(content)) !== null) {
    try {
      const data = JSON.parse(match[2]);
      const url = data.debugUrl || data.liveUrl;
      if (url) {
        embeds.push({ debugUrl: url, sessionId: data.sessionId, interactive: data.interactive });
      }
    } catch { /* ignore */ }
    text = text.replace(match[0], "");
  }

  // Also detect Browser Use live URLs and Steel URLs in raw text
  const urlRegex = /https:\/\/[^\s"]+(?:\.steel\.dev|browser-use\.com\/live|\.browserbase\.com)[^\s"]*/g;
  const urls = content.match(urlRegex) || [];
  for (const url of urls) {
    if (!embeds.some((e) => e.debugUrl === url)) {
      embeds.push({ debugUrl: url, interactive: false });
    }
  }

  return { text: text.trim(), embeds };
}

function MessageContent({ content, role }: { content: string; role: "user" | "assistant" }) {
  const { text, embeds } = useMemo(() =>
    role === "assistant" ? parseBrowserEmbeds(content) : { text: content, embeds: [] },
    [content, role]
  );

  return (
    <>
      {text && <div className="text-sm whitespace-pre-wrap leading-relaxed">{text}</div>}
      {embeds.map((embed, i) => (
        <SteelSessionEmbed
          key={`${embed.debugUrl}-${i}`}
          debugUrl={embed.debugUrl}
          sessionId={embed.sessionId}
          interactive={embed.interactive}
        />
      ))}
    </>
  );
}

export default function Agent() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [voiceAgentId, setVoiceAgentId] = useState("agent_8401kkgdds3de8p949kwdvhhhgr1");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
        body: JSON.stringify({ messages: [...messages, userMsg], stream: true }),
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

      // Flush remaining buffer
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

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Messages Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6">
            {messages.length === 0 ? (
              /* Empty state */
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
                    Your autonomous AI agent with full access to job search, resume optimization, shopping, email monitoring, and web research.
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
              /* Message list */
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
                      <MessageContent content={msg.content} role={msg.role} />
                    </div>
                    {msg.role === "user" && (
                      <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center shrink-0 mt-1">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}

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

        {/* Voice Relay Panel */}
        {showVoice && voiceAgentId && (
          <div className="border-t border-border/40 bg-background/80 px-4 py-3">
            <div className="max-w-3xl mx-auto">
              <VoiceRelayAgent
                agentId={voiceAgentId}
                onTranscript={(role, text) => {
                  console.log(`[Voice ${role}]:`, text);
                }}
              />
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="border-t border-border/40 bg-background/80 backdrop-blur-xl">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <div className="relative flex items-end gap-2">
              <Button
                variant={showVoice ? "default" : "outline"}
                size="icon"
                className="shrink-0 h-10 w-10 rounded-xl"
                onClick={() => {
                  if (!showVoice && !voiceAgentId) {
                    const id = prompt("Enter your ElevenLabs Agent ID:");
                    if (id) {
                      setVoiceAgentId(id);
                      setShowVoice(true);
                    }
                  } else {
                    setShowVoice(!showVoice);
                  }
                }}
                title="Toggle Voice Relay"
              >
                <Mic className="w-4 h-4" />
              </Button>
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
                Manus has full access to your automations. Press Enter to send.
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
