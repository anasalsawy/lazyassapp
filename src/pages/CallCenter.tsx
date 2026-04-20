import { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Phone, PhoneOff, Send, Activity, Brain, Mic,
  Zap, Users, Radio, Loader2, ChevronDown,
  ChevronUp, Volume2,
} from "lucide-react";

type CallState = {
  taskId: string;
  status: string;
  callSid?: string;
  turnCount: number;
  conversationHistory: Array<{ role: string; content: string }>;
  blackboard?: {
    answers?: Record<string, string>;
    info?: Record<string, string>;
    directions?: string | null;
    flags?: string[];
    operator?: string | null;
    end_call?: boolean;
    delivered?: Array<{ k?: string; v?: string; at?: string }>;
  };
  plannerMeta?: {
    lastPlannerAt?: string | null;
    plannerCycles?: number;
    lastTranscriptSyncAt?: string | null;
  };
  pendingInjections: number;
  config: any;
};

type RecentCall = {
  taskId: string;
  status: string;
  createdAt: string;
  objective: string;
  turnCount: number;
};

export default function CallCenter() {
  const { session } = useAuth();

  // Call initiation form
  const [phoneNumber, setPhoneNumber] = useState("");
  const [objective, setObjective] = useState("");
  const [callerName, setCallerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [constraints, setConstraints] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Active call state
  const [activeCall, setActiveCall] = useState<CallState | null>(null);
  const [injection, setInjection] = useState("");
  const [isInitiating, setIsInitiating] = useState(false);
  const [isInjecting, setIsInjecting] = useState(false);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [isKilling, setIsKilling] = useState(false);

  // Polling + Realtime boost
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const isActiveRef = useRef(false);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [activeCall?.conversationHistory]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  // Fetch state via REST (primary data source — includes ElevenLabs transcript sync)
  const pollCallState = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-agent?action=get-state&task_id=${taskId}`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        setActiveCall(data);
        return data.status === "completed" || data.status === "failed";
      }
    } catch (e) {
      console.error("[CallCenter] poll error:", e);
    }
    return false;
  }, [session]);

  // Start monitoring a task: poll every 3s + Realtime for instant mid-poll updates
  const subscribeToTask = useCallback((taskId: string) => {
    // Clean up previous
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    activeTaskIdRef.current = taskId;
    isActiveRef.current = true;

    // Realtime channel for instant updates between polls
    const channel = supabase
      .channel(`task-monitor-${taskId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_tasks',
          filter: `id=eq.${taskId}`,
        },
        (payload) => {
          const task = payload.new as any;
          const result = task.result || {};
          const conversationHistory = result?.conversationHistory || [];
          
          // Realtime payloads can be truncated for large JSONB — only use for
          // status changes and transcript updates, never overwrite analysis data
          // with potentially empty fields.
          setActiveCall((prev) => {
            // If no previous state, do a basic parse
            if (!prev) {
              // Trigger an immediate poll to get full data
              pollCallState(taskId);
              return prev;
            }

            // Only update lightweight state from realtime; polls remain source of truth.
            // Accept same-length transcript corrections too so live turns don't appear only after hangup.
            const hasTranscriptUpdate = conversationHistory.length > (prev.conversationHistory?.length || 0)
              || conversationHistory.some((msg, index) => {
                const prevMsg = prev.conversationHistory?.[index];
                return msg.role !== prevMsg?.role || msg.content !== prevMsg?.content;
              });

            const newHistory = hasTranscriptUpdate
              ? conversationHistory
              : prev.conversationHistory;

            return {
              ...prev,
              status: task.status || prev.status,
              turnCount: Math.max(result?.turnCount || 0, newHistory.length, prev.turnCount || 0),
              conversationHistory: newHistory,
              blackboard: result?.blackboard ?? prev.blackboard,
              plannerMeta: {
                lastPlannerAt: result?.lastPlannerAt ?? prev.plannerMeta?.lastPlannerAt,
                plannerCycles: result?.plannerCycles ?? prev.plannerMeta?.plannerCycles,
                lastTranscriptSyncAt: result?.lastTranscriptSyncAt ?? prev.plannerMeta?.lastTranscriptSyncAt,
              },
              pendingInjections: result?.blackboard?.operator ? 1 : (result?.operatorInjections?.length ?? prev.pendingInjections),
            };
          });

          // Stop if call ended
          if (task.status === "completed" || task.status === "failed") {
            isActiveRef.current = false;
            if (channelRef.current) {
              supabase.removeChannel(channelRef.current);
              channelRef.current = null;
            }
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    // Polling loop with a tighter interval so transcript sync feels live.
    const poll = async () => {
      if (!isActiveRef.current) return;
      const ended = await pollCallState(taskId);
      if (ended) {
        isActiveRef.current = false;
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }
        return;
      }
      if (isActiveRef.current) {
        pollTimeoutRef.current = setTimeout(poll, 1200);
      }
    };

    // Immediate first fetch, then start loop
    poll();
  }, [pollCallState]);

  // Load recent calls
  useEffect(() => {
    if (!session?.access_token) return;
    (async () => {
      try {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-agent?action=list-calls`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          setRecentCalls(data.calls || []);
        }
      } catch { /* ignore */ }
    })();
  }, [session]);

  // Initiate call
  const initiateCall = async () => {
    if (!phoneNumber || !objective || !session?.access_token) return;
    setIsInitiating(true);
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-agent?action=initiate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            phone_number: phoneNumber,
            objective,
            caller_name: callerName,
            company_name: companyName,
            constraints,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to initiate call");

      toast.success("Call initiated!", { description: `Calling ${phoneNumber}` });
      subscribeToTask(data.taskId);
    } catch (e: any) {
      toast.error("Call failed", { description: e.message });
    } finally {
      setIsInitiating(false);
    }
  };

  // Inject instruction
  const injectInstruction = async () => {
    if (!injection.trim() || !activeCall?.taskId || !session?.access_token) return;
    setIsInjecting(true);
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
          body: JSON.stringify({
            task_id: activeCall.taskId,
            instruction: injection,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to inject");
      toast.success("Instruction injected", { description: "Will apply on next turn." });
      setInjection("");
    } catch (e: any) {
      toast.error("Injection failed", { description: e.message });
    } finally {
      setIsInjecting(false);
    }
  };

  // Resume monitoring a recent call
  const resumeMonitoring = (taskId: string) => {
    subscribeToTask(taskId);
  };

  // Kill active call
  const killCall = async () => {
    if (!activeCall?.taskId || !session?.access_token) return;
    setIsKilling(true);
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-agent?action=kill`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ task_id: activeCall.taskId }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to kill call");
      toast.success("Call killed");
      isActiveRef.current = false;
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
      setActiveCall((prev) => prev ? { ...prev, status: "failed" } : null);
    } catch (e: any) {
      toast.error("Kill failed", { description: e.message });
    } finally {
      setIsKilling(false);
    }
  };

  const isCallActive = activeCall?.status === "running";

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Header */}
        <div className="border-b border-border/40 bg-background/80 backdrop-blur-xl px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 via-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Phone className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold">Call Center</h1>
              <p className="text-xs text-muted-foreground">Multi-Agent Voice System — Director • Analyst • Caller</p>
            </div>
            {isCallActive && (
              <Badge className="ml-auto bg-emerald-500/20 text-emerald-400 border-emerald-500/30 animate-pulse">
                <Radio className="w-3 h-3 mr-1" /> LIVE
              </Badge>
            )}
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel: Call Controls + Transcript */}
          <div className="flex-1 flex flex-col overflow-hidden border-r border-border/30">
            {!isCallActive && !activeCall ? (
              /* ── CALL INITIATION FORM ── */
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-lg mx-auto space-y-6">
                  <div className="text-center space-y-2 mb-8">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-red-500/20 to-amber-500/20 border border-red-500/30 flex items-center justify-center">
                      <Users className="w-8 h-8 text-red-400" />
                    </div>
                    <h2 className="text-2xl font-bold">New Call</h2>
                    <p className="text-muted-foreground text-sm">
                      3-agent pipeline: Analyst evaluates, Director strategizes, Caller speaks.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Phone Number</label>
                      <Input
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+1 (555) 123-4567"
                        className="bg-muted/30"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Call Objective</label>
                      <Textarea
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        placeholder="What should the AI accomplish on this call? Be specific..."
                        className="bg-muted/30 min-h-[80px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Agent Name</label>
                        <Input
                          value={callerName}
                          onChange={(e) => setCallerName(e.target.value)}
                          placeholder="Maya"
                          className="bg-muted/30"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Company</label>
                        <Input
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          placeholder="Your company name"
                          className="bg-muted/30"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      Advanced Settings
                    </button>

                    {showAdvanced && (
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Constraints / Rules</label>
                        <Textarea
                          value={constraints}
                          onChange={(e) => setConstraints(e.target.value)}
                          placeholder="e.g., Don't go below $350, max 10 min call, don't discuss competitors..."
                          className="bg-muted/30 min-h-[60px]"
                        />
                      </div>
                    )}

                    <Button
                      onClick={initiateCall}
                      disabled={!phoneNumber || !objective || isInitiating}
                      className="w-full bg-gradient-to-r from-red-500 to-amber-500 hover:from-red-600 hover:to-amber-600 text-white"
                      size="lg"
                    >
                      {isInitiating ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Initiating Call...</>
                      ) : (
                        <><Phone className="w-4 h-4 mr-2" /> Start Multi-Agent Call</>
                      )}
                    </Button>
                  </div>

                  {/* Recent Calls */}
                  {recentCalls.length > 0 && (
                    <div className="mt-8">
                      <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Recent Calls</h3>
                      <div className="space-y-2">
                        {recentCalls.slice(0, 5).map((call) => (
                          <button
                            key={call.taskId}
                            onClick={() => resumeMonitoring(call.taskId)}
                            className="w-full flex items-center justify-between p-3 rounded-lg border border-border/40 bg-card/30 hover:bg-card/60 transition-colors text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{call.objective}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(call.createdAt).toLocaleString()} · {call.turnCount} turns
                              </p>
                            </div>
                            <Badge variant={call.status === "completed" ? "default" : call.status === "running" ? "secondary" : "destructive"} className="text-xs ml-2 shrink-0">
                              {call.status}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ── LIVE CALL VIEW ── */
              <>
                {/* Call Info Bar */}
                <div className="px-4 py-3 bg-muted/20 border-b border-border/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Volume2 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium truncate max-w-[200px]">
                      {activeCall?.config?.objective}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      <Activity className="w-3 h-3 mr-1" />
                      Turn {activeCall?.turnCount || 0}
                    </Badge>
                    <Badge variant={isCallActive ? "default" : "secondary"} className="text-xs">
                      {activeCall?.status}
                    </Badge>
                    {isCallActive && (
                      <Button
                        onClick={killCall}
                        disabled={isKilling}
                        size="sm"
                        variant="destructive"
                        className="ml-1 h-7 text-xs"
                      >
                        {isKilling ? <Loader2 className="w-3 h-3 animate-spin" /> : <PhoneOff className="w-3 h-3 mr-1" />}
                        Kill
                      </Button>
                    )}
                  </div>
                </div>

                {/* Transcript */}
                <div ref={transcriptRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  {activeCall?.conversationHistory.map((msg, i) => (
                    <div key={i} className={`flex gap-2 ${msg.role === "user" ? "" : "justify-end"}`}>
                      {msg.role === "user" && (
                        <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                          <Mic className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                      )}
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-blue-500/10 border border-blue-500/20"
                          : "bg-emerald-500/10 border border-emerald-500/20"
                      }`}>
                        <p className="text-xs font-medium mb-0.5 text-muted-foreground">
                          {msg.role === "user" ? "Human" : "Agent"}
                        </p>
                        {msg.content}
                      </div>
                      {msg.role === "assistant" && (
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                          <Phone className="w-3.5 h-3.5 text-emerald-400" />
                        </div>
                      )}
                    </div>
                  ))}
                  {activeCall?.conversationHistory.length === 0 && (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Waiting for call to connect...
                    </div>
                  )}
                </div>

                {/* Operator Injection Bar */}
                {isCallActive && (
                  <div className="border-t border-border/40 p-3 bg-background/80">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                        <Input
                          value={injection}
                          onChange={(e) => setInjection(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && injectInstruction()}
                          placeholder="Inject instruction... (e.g., 'Ask about travel dates')"
                          className="pl-9 bg-muted/30 border-amber-500/30 focus-visible:ring-amber-500/30"
                        />
                      </div>
                      <Button
                        onClick={injectInstruction}
                        disabled={!injection.trim() || isInjecting}
                        size="sm"
                        className="bg-amber-500 hover:bg-amber-600 text-white shrink-0"
                      >
                        {isInjecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 pl-1">
                      ⚡ Injections are applied on the next turn. The human won't know you intervened.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right Panel: Blackboard */}
          <div className="w-80 flex flex-col overflow-hidden bg-muted/5">
            <div className="p-4 border-b border-border/30">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" /> Blackboard
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activeCall ? (
                <>
                  <Card className="bg-card/50 border-border/40">
                    <CardHeader className="pb-2 pt-3 px-3">
                      <CardTitle className="text-xs font-semibold">Current State</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3 space-y-3 text-xs">
                      <div>
                        <span className="text-muted-foreground">Strategic direction</span>
                        <p className="mt-1">{activeCall.blackboard?.directions || "—"}</p>
                      </div>

                      {activeCall.blackboard?.operator && (
                        <div>
                          <span className="text-muted-foreground">Operator override</span>
                          <p className="mt-1">{activeCall.blackboard.operator}</p>
                        </div>
                      )}

                      <div>
                        <span className="text-muted-foreground">Flags</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(activeCall.blackboard?.flags || []).length > 0 ? (
                            activeCall.blackboard?.flags?.map((flag, index) => (
                              <Badge key={`${flag}-${index}`} variant="secondary" className="text-[10px] px-1.5 py-0">
                                {flag}
                              </Badge>
                            ))
                          ) : (
                            <span>—</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <span className="text-muted-foreground">Facts</span>
                        <div className="mt-1 space-y-1">
                          {activeCall.blackboard?.info && Object.keys(activeCall.blackboard.info).length > 0 ? (
                            Object.entries(activeCall.blackboard.info).map(([key, value]) => (
                              <div key={key} className="flex gap-2">
                                <span className="text-muted-foreground min-w-0 shrink-0">{key}</span>
                                <span className="break-words">{String(value)}</span>
                              </div>
                            ))
                          ) : (
                            <span>—</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <span className="text-muted-foreground">Answers</span>
                        <div className="mt-1 space-y-1">
                          {activeCall.blackboard?.answers && Object.keys(activeCall.blackboard.answers).length > 0 ? (
                            Object.entries(activeCall.blackboard.answers).map(([key, value]) => (
                              <div key={key} className="flex gap-2">
                                <span className="text-muted-foreground min-w-0 shrink-0">{key}</span>
                                <span className="break-words">{String(value)}</span>
                              </div>
                            ))
                          ) : (
                            <span>—</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <span className="text-muted-foreground">End call</span>
                        <p className="mt-1">{activeCall.blackboard?.end_call ? "yes" : "no"}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/50 border-border/40">
                    <CardHeader className="pb-2 pt-3 px-3">
                      <CardTitle className="text-xs font-semibold">Planner Status</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3 space-y-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Cycles: </span>
                        <span>{activeCall.plannerMeta?.plannerCycles ?? 0}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Last planner run: </span>
                        <span>{activeCall.plannerMeta?.lastPlannerAt ? new Date(activeCall.plannerMeta.lastPlannerAt).toLocaleTimeString() : "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Last transcript sync: </span>
                        <span>{activeCall.plannerMeta?.lastTranscriptSyncAt ? new Date(activeCall.plannerMeta.lastTranscriptSyncAt).toLocaleTimeString() : "—"}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {activeCall.pendingInjections > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 border border-border/40 text-xs">
                      <Zap className="w-3.5 h-3.5 text-primary" />
                      <span>{activeCall.pendingInjections} injection(s) pending planner assimilation</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground space-y-3 p-3 bg-muted/10 rounded-lg">
                  <p className="font-semibold text-foreground">Blackboard Flow</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-muted flex items-center justify-center">
                        <Zap className="w-3 h-3 text-primary" />
                      </div>
                      <span>You inject strategy</span>
                    </div>
                    <div className="w-px h-3 bg-border/50 ml-2.5" />
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-muted flex items-center justify-center">
                        <Brain className="w-3 h-3 text-primary" />
                      </div>
                      <span>Planner updates blackboard in background</span>
                    </div>
                    <div className="w-px h-3 bg-border/50 ml-2.5" />
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-muted flex items-center justify-center">
                        <Phone className="w-3 h-3 text-primary" />
                      </div>
                      <span>Caller handles the live moment</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
