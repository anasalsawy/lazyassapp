import { useState, useCallback, useEffect, useRef } from "react";
import { useConversation } from "@elevenlabs/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX,
  Activity, Loader2, Send, Radio,
} from "lucide-react";

interface VoiceRelayAgentProps {
  agentId: string;
  onTranscript?: (role: "user" | "agent", text: string) => void;
  onStatusChange?: (status: string) => void;
}

export function VoiceRelayAgent({ agentId, onTranscript, onStatusChange }: VoiceRelayAgentProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [contextInput, setContextInput] = useState("");
  const [transcripts, setTranscripts] = useState<Array<{ role: string; text: string; time: Date }>>([]);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const levelInterval = useRef<ReturnType<typeof setInterval>>();

  const conversation = useConversation({
    onConnect: () => {
      console.log("[VoiceRelay] Connected to ElevenLabs agent");
      onStatusChange?.("connected");
    },
    onDisconnect: () => {
      console.log("[VoiceRelay] Disconnected");
      onStatusChange?.("disconnected");
      if (levelInterval.current) clearInterval(levelInterval.current);
    },
    onMessage: (message) => {
      if (message.type === "user_transcript") {
        const text = (message as any).user_transcription_event?.user_transcript;
        if (text) {
          setTranscripts((prev) => [...prev, { role: "user", text, time: new Date() }]);
          onTranscript?.("user", text);
        }
      } else if (message.type === "agent_response") {
        const text = (message as any).agent_response_event?.agent_response;
        if (text) {
          setTranscripts((prev) => [...prev, { role: "agent", text, time: new Date() }]);
          onTranscript?.("agent", text);
        }
      } else if (message.type === "agent_response_correction") {
        const text = (message as any).agent_response_correction_event?.corrected_agent_response;
        if (text) {
          // Update last agent message with correction
          setTranscripts((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === "agent") {
                updated[i] = { ...updated[i], text };
                break;
              }
            }
            return updated;
          });
        }
      }
    },
    onError: (error) => {
      console.error("[VoiceRelay] Error:", error);
      onStatusChange?.("error");
    },
  });

  // Auto-scroll transcripts
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  // Poll audio levels when connected
  useEffect(() => {
    if (conversation.status === "connected") {
      levelInterval.current = setInterval(() => {
        setInputLevel(conversation.getInputVolume());
        setOutputLevel(conversation.getOutputVolume());
      }, 100);
    }
    return () => {
      if (levelInterval.current) clearInterval(levelInterval.current);
    };
  }, [conversation.status]);

  const startConversation = useCallback(async () => {
    setIsConnecting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const { data, error } = await supabase.functions.invoke(
        "elevenlabs-conversation-token",
        { body: { agent_id: agentId } }
      );

      if (error || !data?.token) {
        throw new Error(error?.message || "No token received");
      }

      await conversation.startSession({
        conversationToken: data.token,
        connectionType: "webrtc",
      });

      setTranscripts([]);
    } catch (error: any) {
      console.error("[VoiceRelay] Failed to start:", error);
      onStatusChange?.("error");
    } finally {
      setIsConnecting(false);
    }
  }, [conversation, agentId, onStatusChange]);

  const stopConversation = useCallback(async () => {
    await conversation.endSession();
    setTranscripts([]);
  }, [conversation]);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      conversation.setVolume({ volume: 1 });
    } else {
      conversation.setVolume({ volume: 0 });
    }
    setIsMuted(!isMuted);
  }, [conversation, isMuted]);

  // Director injects context mid-conversation without triggering a response
  const sendContext = useCallback(() => {
    if (!contextInput.trim()) return;
    conversation.sendContextualUpdate(`[DIRECTOR_CONTEXT] ${contextInput.trim()}`);
    setTranscripts((prev) => [
      ...prev,
      { role: "director", text: contextInput.trim(), time: new Date() },
    ]);
    setContextInput("");
  }, [conversation, contextInput]);

  const isConnected = conversation.status === "connected";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-primary" />
          <span className="font-medium text-sm">Voice Relay</span>
          <Badge
            variant={isConnected ? "default" : "outline"}
            className="text-xs"
          >
            {isConnecting ? "Connecting..." : isConnected ? "Live" : "Offline"}
          </Badge>
        </div>

        {isConnected && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Mic className="w-3 h-3" />
              <span
                className="inline-block h-2 rounded-full bg-green-500 transition-all"
                style={{ width: `${Math.max(4, inputLevel * 40)}px` }}
              />
            </span>
            <span className="flex items-center gap-1">
              <Volume2 className="w-3 h-3" />
              <span
                className="inline-block h-2 rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.max(4, outputLevel * 40)}px` }}
              />
            </span>
          </div>
        )}
      </div>

      {/* Live Transcript */}
      {isConnected && (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto rounded-lg bg-muted/30 p-3 space-y-2"
        >
          {transcripts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {conversation.isSpeaking ? "Agent is speaking..." : "Listening..."}
            </p>
          ) : (
            transcripts.map((t, i) => (
              <div key={i} className="text-xs">
                <span
                  className={`font-semibold ${
                    t.role === "user"
                      ? "text-blue-400"
                      : t.role === "director"
                      ? "text-yellow-400"
                      : "text-green-400"
                  }`}
                >
                  {t.role === "user" ? "You" : t.role === "director" ? "📋 Director" : "🤖 Agent"}:
                </span>{" "}
                <span className="text-foreground/80">{t.text}</span>
              </div>
            ))
          )}
          {conversation.isSpeaking && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Activity className="w-3 h-3 animate-pulse" />
              <span>Speaking...</span>
            </div>
          )}
        </div>
      )}

      {/* Director Context Injection */}
      {isConnected && (
        <div className="flex items-end gap-2">
          <Textarea
            value={contextInput}
            onChange={(e) => setContextInput(e.target.value)}
            placeholder="Inject Director context (silent instruction)..."
            className="min-h-[36px] max-h-[80px] resize-none text-xs rounded-lg bg-muted/20"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendContext();
              }
            }}
          />
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0"
            onClick={sendContext}
            disabled={!contextInput.trim()}
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2">
        {!isConnected ? (
          <Button
            onClick={startConversation}
            disabled={isConnecting}
            className="flex-1 gap-2"
            variant="default"
          >
            {isConnecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Phone className="w-4 h-4" />
            )}
            {isConnecting ? "Connecting..." : "Start Voice"}
          </Button>
        ) : (
          <>
            <Button
              onClick={toggleMute}
              variant="outline"
              size="icon"
              className="shrink-0"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </Button>
            <Button
              onClick={stopConversation}
              variant="destructive"
              className="flex-1 gap-2"
            >
              <PhoneOff className="w-4 h-4" />
              End Voice
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
