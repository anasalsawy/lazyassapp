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
  Phone, PhoneOff, Send, Activity, Brain, Eye, Mic,
  AlertTriangle, CheckCircle, Clock, MessageSquare,
  Zap, Users, BarChart3, Radio, Loader2, ChevronDown,
  ChevronUp, Volume2,
} from "lucide-react";

type CallState = {
  taskId: string;
  status: string;
  callSid?: string;
  turnCount: number;
  conversationHistory: Array<{ role: string; content: string }>;
  lastAnalysis: any;
  lastDirective: any;
  pendingInjections: number;
  config: any;
};

type RecentCall = {
  taskId: string;
  status: string;
  createdAt: string;
  objective: string;
  turnCount: number;
  lastAnalysis: any;
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

  // Polling
  const pollRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [activeCall?.conversationHistory]);

  // Poll active call state
  const pollCallState = useCallback(async (taskId: string) => {
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
        if (data.status === "completed" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch (e) {
      console.error("[CallCenter] poll error:", e);
    }
  }, [session]);

  // Start polling when we have an active call
  const startPolling = useCallback((taskId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => pollCallState(taskId), 3000);
    pollCallState(taskId); // immediate first poll
  }, [pollCallState]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

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
      startPolling(data.taskId);
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
    startPolling(taskId);
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
      if (pollRef.current) clearInterval(pollRef.current);
      setActiveCall((prev) => prev ? { ...prev, status: "failed" } : null);
    } catch (e: any) {
      toast.error("Kill failed", { description: e.message });
    } finally {
      setIsKilling(false);
    }
  };

  const toneColor = (tone: string) => {
    switch (tone) {
      case "hostile": case "impatient": return "text-red-400";
      case "confused": case "stressed": case "anxious": return "text-amber-400";
      case "friendly": case "warm": case "interested": case "excited": return "text-emerald-400";
      case "cooperative": return "text-blue-400";
      default: return "text-muted-foreground";
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
                      <MessageSquare className="w-3 h-3 mr-1" />
                      Turn {activeCall?.turnCount || 0}
                    </Badge>
                    <Badge variant={isCallActive ? "default" : "secondary"} className="text-xs">
                      {activeCall?.status}
                    </Badge>
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

          {/* Right Panel: Agent Intelligence */}
          <div className="w-80 flex flex-col overflow-hidden bg-muted/5">
            <div className="p-4 border-b border-border/30">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" /> Agent Intelligence
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Analyst Report */}
              {activeCall?.lastAnalysis && (
                <Card className="bg-card/50 border-border/40">
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-cyan-400" /> Analyst
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Tone</span>
                        <p className={`font-medium capitalize ${toneColor(activeCall.lastAnalysis.tone)}`}>
                          {activeCall.lastAnalysis.tone}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Engagement</span>
                        <p className="font-medium capitalize">{activeCall.lastAnalysis.engagement}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cooperation</span>
                        <p className="font-medium capitalize">{activeCall.lastAnalysis.cooperation}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Emotional</span>
                        <p className="font-medium capitalize">{activeCall.lastAnalysis.emotional_state}</p>
                      </div>
                    </div>

                    {activeCall.lastAnalysis.intent && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Intent: </span>
                        <span>{activeCall.lastAnalysis.intent}</span>
                      </div>
                    )}

                    {activeCall.lastAnalysis.risks?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {activeCall.lastAnalysis.risks.map((r: string, i: number) => (
                          <Badge key={i} variant="destructive" className="text-[10px] px-1.5 py-0">
                            <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> {r}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {activeCall.lastAnalysis.opportunities?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {activeCall.lastAnalysis.opportunities.map((o: string, i: number) => (
                          <Badge key={i} className="text-[10px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                            <CheckCircle className="w-2.5 h-2.5 mr-0.5" /> {o}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {activeCall.lastAnalysis.recommended_approach && (
                      <div className="text-xs bg-muted/30 rounded p-2 mt-1">
                        <span className="text-muted-foreground">Recommendation: </span>
                        {activeCall.lastAnalysis.recommended_approach}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Director Decision */}
              {activeCall?.lastDirective && (
                <Card className="bg-card/50 border-border/40">
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5 text-amber-400" /> Director
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Instruction: </span>
                      <span>{activeCall.lastDirective.instruction}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tone: </span>
                      <span>{activeCall.lastDirective.tone}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Priority: </span>
                      <span>{activeCall.lastDirective.priority}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Pending Injections */}
              {activeCall && activeCall.pendingInjections > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>{activeCall.pendingInjections} injection(s) pending</span>
                </div>
              )}

              {/* Architecture Diagram */}
              {!activeCall?.lastAnalysis && (
                <div className="text-xs text-muted-foreground space-y-3 p-3 bg-muted/10 rounded-lg">
                  <p className="font-semibold text-foreground">Multi-Agent Pipeline</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center">
                        <Zap className="w-3 h-3 text-amber-400" />
                      </div>
                      <span>You → inject instructions</span>
                    </div>
                    <div className="w-px h-3 bg-border/50 ml-2.5" />
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center">
                        <Eye className="w-3 h-3 text-cyan-400" />
                      </div>
                      <span>Analyst → evaluates tone & intent</span>
                    </div>
                    <div className="w-px h-3 bg-border/50 ml-2.5" />
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">
                        <Brain className="w-3 h-3 text-purple-400" />
                      </div>
                      <span>Director → decides strategy</span>
                    </div>
                    <div className="w-px h-3 bg-border/50 ml-2.5" />
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center">
                        <Phone className="w-3 h-3 text-emerald-400" />
                      </div>
                      <span>Caller → speaks naturally</span>
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
