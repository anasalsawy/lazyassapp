import { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Phone, PhoneOff, Send, Activity, Brain, Eye, Mic,
  AlertTriangle, CheckCircle, Clock, MessageSquare,
  Zap, Users, BarChart3, Radio, Loader2, ChevronDown,
  ChevronUp, Volume2, RefreshCw, Plus, X, Sparkles, Search,
} from "lucide-react";

type CallState = {
  taskId: string;
  status: string;
  callSid?: string;
  turnCount: number;
  conversationHistory: Array<{ role: string; content: string }>;
  lastAnalysis?: any;
  lastDirective?: any; // legacy shape
  lastDirectorDirective?: string | null;
  directorDirectiveHistory?: Array<{ directive: string; turnNumber?: number; createdAt?: string }>;
  operatorInjectionHistory?: Array<{ instruction: string; status?: string; createdAt?: string; consumedAt?: string }>;
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

  // Mode: smart (prompt-only) vs manual (phone number)
  const [smartMode, setSmartMode] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [smartLocation, setSmartLocation] = useState("");

  // Call initiation form (manual mode)
  const [phoneNumber, setPhoneNumber] = useState("");
  const [objective, setObjective] = useState("");
  const [callerName, setCallerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [constraints, setConstraints] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Auto-retry state
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(false);
  const [retryStores, setRetryStores] = useState<Array<{ name: string; phone: string; why?: string }>>([]);
  const [newRetryName, setNewRetryName] = useState("");
  const [newRetryPhone, setNewRetryPhone] = useState("");
  const [isSearchingStores, setIsSearchingStores] = useState(false);
  const [searchLocation, setSearchLocation] = useState("");

  // Active call state
  const [activeCall, setActiveCall] = useState<CallState | null>(null);
  const [injection, setInjection] = useState("");
  const [isInitiating, setIsInitiating] = useState(false);
  const [isInjecting, setIsInjecting] = useState(false);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [retryQueue, setRetryQueue] = useState<Array<{ name: string; phone: string }>>([]);
  const retryQueueRef = useRef<Array<{ name: string; phone: string }>>([]);
  const hasAutoResumedRef = useRef(false);

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
        if (data.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          toast.success("Call completed successfully!");
        } else if (data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          
          // Auto-retry: try next store in queue
          if (retryQueueRef.current.length > 0) {
            const nextStore = retryQueueRef.current.shift()!;
            setRetryQueue([...retryQueueRef.current]);
            setRetryAttempt(prev => prev + 1);
            toast.info(`Call failed — auto-retrying ${nextStore.name}...`, {
              icon: <RefreshCw className="w-4 h-4 animate-spin" />,
            });
            // Initiate retry call
            retryCall(nextStore);
          } else {
            toast.error("Call failed", { description: data.config?.errorMessage || "No answer or call couldn't complete" });
          }
        }
      }
    } catch (e) {
      console.error("[CallCenter] poll error:", e);
    }
  }, [session]);

  // Retry call with a different store
  const retryCall = useCallback(async (store: { name: string; phone: string }) => {
    if (!session?.access_token) return;
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
            phone_number: store.phone,
            objective,
            caller_name: callerName,
            company_name: store.name,
            constraints,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(`Retry to ${store.name} failed`, { description: data.error });
        // Try next store
        if (retryQueueRef.current.length > 0) {
          const next = retryQueueRef.current.shift()!;
          setRetryQueue([...retryQueueRef.current]);
          setRetryAttempt(prev => prev + 1);
          retryCall(next);
        }
        return;
      }
      startPolling(data.taskId);
    } catch (e: any) {
      toast.error(`Retry failed`, { description: e.message });
    }
  }, [session, objective, callerName, constraints]);

  // Start polling when we have an active call
  const startPolling = useCallback((taskId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => pollCallState(taskId), 3000);
    pollCallState(taskId); // immediate first poll
  }, [pollCallState]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Load recent calls and auto-resume any running call
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
          const calls = Array.isArray(data?.calls) ? data.calls : [];
          setRecentCalls(calls);

          if (!hasAutoResumedRef.current) {
            const runningCall = calls.find((call: any) => call?.status === "running" && call?.taskId);
            if (runningCall?.taskId) {
              hasAutoResumedRef.current = true;
              startPolling(runningCall.taskId);
            }
          }
        }
      } catch {
        /* ignore */
      }
    })();
  }, [session, startPolling]);

  // Smart mode: search for stores, then auto-call first one with rest as retries
  const initiateSmartCall = async () => {
    if (!prompt.trim() || !session?.access_token) return;
    setIsInitiating(true);
    setRetryAttempt(0);

    try {
      // Step 1: Search for stores
      toast.info("Searching for relevant stores...", { icon: <Search className="w-4 h-4" /> });
      const searchResp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/product-finder?action=find-candidates`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            objective: prompt,
            location: smartLocation || undefined,
          }),
        }
      );
      const searchData = await searchResp.json();

      const finder = searchData.product_finder_result || {};
      const stores = (finder.candidates || []).map((s: any) => ({
        name: s.name,
        phone: s.phone_e164,
        address: s.address,
        department_hint: s.department_hint,
      })).filter((s: any) => !!s.phone);

      if (!searchResp.ok || !stores.length) {
        toast.error("Couldn't find any stores", {
          description: "Try being more specific or switch to manual mode.",
        });
        setIsInitiating(false);
        return;
      }

      const primaryStore = stores[0];
      const backupStores = stores.slice(1);

      toast.success(`Found ${stores.length} stores — calling ${primaryStore.name}`, {
        description: `Product: ${finder.product_intent?.normalized_product || prompt}`,
      });

      // Set up retry queue with remaining stores
      retryQueueRef.current = [...backupStores];
      setRetryQueue([...backupStores]);
      setRetryStores(stores);

      // Step 2: Start a mission with ALL stores for auto-retry
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mission-executive?action=start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            objective: prompt,
            caller_name: callerName || "Maya",
            constraints: constraints || undefined,
            location: smartLocation || undefined,
            max_attempts: stores.length,
            store_limit: stores.length,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to initiate mission");

      toast.success("Mission started!", {
        description: `Calling ${primaryStore.name} (${primaryStore.phone}) · ${stores.length} candidates loaded`,
      });
      // Poll the first child call task, or the mission task
      startPolling(data.firstCall?.child_task_id || data.missionId);
    } catch (e: any) {
      toast.error("Smart call failed", { description: e.message });
    } finally {
      setIsInitiating(false);
    }
  };

  // Initiate call (manual mode)
  const initiateCall = async () => {
    if (!phoneNumber || !objective || !session?.access_token) return;
    setIsInitiating(true);
    setRetryAttempt(0);
    
    // Set up retry queue if auto-retry is enabled
    if (autoRetryEnabled && retryStores.length > 0) {
      retryQueueRef.current = [...retryStores];
      setRetryQueue([...retryStores]);
    } else {
      retryQueueRef.current = [];
      setRetryQueue([]);
    }

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

      const retryMsg = autoRetryEnabled && retryStores.length > 0 
        ? ` (${retryStores.length} backup stores queued)` 
        : '';
      toast.success("Call initiated!", { description: `Calling ${phoneNumber}${retryMsg}` });
      startPolling(data.taskId);
    } catch (e: any) {
      toast.error("Call failed", { description: e.message });
    } finally {
      setIsInitiating(false);
    }
  };

  // Add retry store helper
  const addRetryStore = () => {
    if (!newRetryName.trim() || !newRetryPhone.trim()) return;
    const phone = newRetryPhone.startsWith('+') ? newRetryPhone : `+1${newRetryPhone.replace(/\D/g, '')}`;
    setRetryStores(prev => [...prev, { name: newRetryName.trim(), phone }]);
    setNewRetryName("");
    setNewRetryPhone("");
  };

  const removeRetryStore = (index: number) => {
    setRetryStores(prev => prev.filter((_, i) => i !== index));
  };

  // Smart store search
  const searchStores = async () => {
    if (!objective.trim() || !session?.access_token) return;
    setIsSearchingStores(true);
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/product-finder?action=find-candidates`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            objective,
            location: searchLocation || undefined,
          }),
        }
      );
      const data = await resp.json();
      const finderData = data.product_finder_result || {};
      const stores = (finderData.candidates || []).map((s: any) => ({ name: s.name, phone: s.phone_e164, why: s.why_ranked })).filter((s: any) => !!s.phone);
      if (!resp.ok) {
        toast.error("Search failed", { description: data.error || "Could not find stores" });
        return;
      }
      if (stores.length > 0) {
        setRetryStores(prev => {
          const existingPhones = new Set(prev.map((s: any) => s.phone));
          const newStores = stores.filter((s: any) => !existingPhones.has(s.phone));
          return [...prev, ...newStores];
        });
        toast.success(`Found ${stores.length} stores`, {
          description: `Product: ${finderData.product_intent?.normalized_product || objective}`,
        });
      } else {
        toast.info("No stores found", { description: "Try adding them manually" });
      }
    } catch (e: any) {
      toast.error("Search error", { description: e.message });
    } finally {
      setIsSearchingStores(false);
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
    hasAutoResumedRef.current = true;
    startPolling(taskId);
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

  const killCall = async (taskId: string) => {
    try {
      if (!session?.access_token) throw new Error("Not authenticated");
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-agent?action=end-call`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ task_id: taskId }),
        },
      );

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || "Unknown error");

      toast.success("Call terminated");
      if (activeCall?.taskId === taskId) {
        setActiveCall(null);
        if (pollRef.current) clearInterval(pollRef.current);
      }
      setRecentCalls(prev => prev.map(c => c.taskId === taskId ? { ...c, status: "failed" } : c));
    } catch (err: any) {
      toast.error("Failed to kill call: " + (err.message || "Unknown error"));
    }
  };

  const isCallLive = activeCall?.status === "running";
  const isCallActive = activeCall?.status === "running" || activeCall?.status === "ringing";
  const runningCalls = recentCalls.filter((call) => call.status === "running");
  const directorHistory = activeCall?.directorDirectiveHistory ?? [];
  const injectionHistory = activeCall?.operatorInjectionHistory ?? [];
  const latestDirectorDirective = activeCall?.lastDirectorDirective || directorHistory[directorHistory.length - 1]?.directive || null;

  const formatPanelTime = (value?: string) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

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
            {isCallLive && (
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
                  {runningCalls.length > 0 && (
                    <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {runningCalls.length} call{runningCalls.length > 1 ? "s" : ""} currently running
                      </p>
                      <div className="space-y-2">
                        {runningCalls.slice(0, 3).map((call) => (
                          <Button
                            key={call.taskId}
                            variant="outline"
                            size="sm"
                            className="w-full justify-start"
                            onClick={() => resumeMonitoring(call.taskId)}
                          >
                            <Radio className="w-3.5 h-3.5 mr-2" />
                            <span className="truncate">{call.objective || call.taskId}</span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="text-center space-y-2 mb-8">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-red-500/20 to-amber-500/20 border border-red-500/30 flex items-center justify-center">
                      <Users className="w-8 h-8 text-red-400" />
                    </div>
                    <h2 className="text-2xl font-bold">New Call</h2>
                    <p className="text-muted-foreground text-sm">
                      Just say what you need — or switch to manual mode for full control.
                    </p>
                  </div>

                  {/* Mode Toggle */}
                  <div className="flex items-center justify-center gap-2 p-1 rounded-lg bg-muted/30 border border-border/40">
                    <button
                      onClick={() => setSmartMode(true)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                        smartMode ? "bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/30" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Smart Mode
                    </button>
                    <button
                      onClick={() => setSmartMode(false)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                        !smartMode ? "bg-muted/50 text-foreground border border-border/40" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Phone className="w-3.5 h-3.5" />
                      Manual
                    </button>
                  </div>

                  <div className="space-y-4">
                    {smartMode ? (
                      /* ── SMART MODE ── */
                      <>
                        <div>
                          <label className="text-sm font-medium mb-1.5 block">What do you need?</label>
                          <Textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={"e.g. Order 2 large pepperoni pizzas for delivery to 123 Main St, Houston TX\ne.g. Buy Meta Ray-Ban smart glasses, Wayfarer style in matte black\ne.g. Book a table for 4 tonight at an Italian restaurant near downtown"}
                            className="bg-muted/30 min-h-[100px]"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-sm font-medium mb-1.5 block">Location (optional)</label>
                            <Input
                              value={smartLocation}
                              onChange={(e) => setSmartLocation(e.target.value)}
                              placeholder="e.g. Houston TX"
                              className="bg-muted/30"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-1.5 block">Agent Name</label>
                            <Input
                              value={callerName}
                              onChange={(e) => setCallerName(e.target.value)}
                              placeholder="Maya"
                              className="bg-muted/30"
                            />
                          </div>
                        </div>

                        <button
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          Constraints
                        </button>
                        {showAdvanced && (
                          <Textarea
                            value={constraints}
                            onChange={(e) => setConstraints(e.target.value)}
                            placeholder="e.g., Max budget $500, don't share email, use card ending 4567..."
                            className="bg-muted/30 min-h-[60px]"
                          />
                        )}

                        <Button
                          onClick={initiateSmartCall}
                          disabled={!prompt.trim() || isInitiating}
                          className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                          size="lg"
                        >
                          {isInitiating ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Finding stores & calling...</>
                          ) : (
                            <><Sparkles className="w-4 h-4 mr-2" /> Find & Call</>
                          )}
                        </Button>
                      </>
                    ) : (
                      /* ── MANUAL MODE ── */
                      <>
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
                              placeholder="e.g., Don't go below $350, max 10 min call..."
                              className="bg-muted/30 min-h-[60px]"
                            />
                          </div>
                        )}

                        {/* Auto-Retry Toggle */}
                        <div className="rounded-xl border border-border/40 bg-card/30 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <RefreshCw className="w-4 h-4 text-amber-400" />
                              <div>
                                <p className="text-sm font-medium">Auto-Retry on Failure</p>
                                <p className="text-xs text-muted-foreground">Automatically try backup stores if call fails</p>
                              </div>
                            </div>
                            <Switch
                              checked={autoRetryEnabled}
                              onCheckedChange={setAutoRetryEnabled}
                            />
                          </div>

                          {autoRetryEnabled && (
                            <div className="space-y-3 pt-2 border-t border-border/30">
                              <p className="text-xs text-muted-foreground">
                                Search for stores or add manually.
                              </p>
                              <div className="flex items-center gap-2">
                                <Input
                                  value={searchLocation}
                                  onChange={(e) => setSearchLocation(e.target.value)}
                                  placeholder="Location (optional)"
                                  className="bg-muted/20 text-sm h-8"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={searchStores}
                                  disabled={isSearchingStores || !objective.trim()}
                                  className="h-8 px-3 shrink-0 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                                >
                                  {isSearchingStores ? (
                                    <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Searching...</>
                                  ) : (
                                    <><Zap className="w-3.5 h-3.5 mr-1" /> Find Stores</>
                                  )}
                                </Button>
                              </div>
                              {retryStores.length > 0 && (
                                <div className="space-y-1.5">
                                  {retryStores.map((store, i) => (
                                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30 text-sm">
                                      <span className="text-xs font-mono text-muted-foreground w-5">{i + 1}.</span>
                                      <span className="flex-1 truncate">{store.name}</span>
                                      {store.why && (
                                        <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={store.why}>{store.why}</span>
                                      )}
                                      <span className="text-xs text-muted-foreground font-mono">{store.phone}</span>
                                      <button onClick={() => removeRetryStore(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <Input value={newRetryName} onChange={(e) => setNewRetryName(e.target.value)} placeholder="Store name" className="bg-muted/20 text-sm h-8" />
                                <Input value={newRetryPhone} onChange={(e) => setNewRetryPhone(e.target.value)} placeholder="+1 555-123-4567" className="bg-muted/20 text-sm h-8 w-40" onKeyDown={(e) => e.key === 'Enter' && addRetryStore()} />
                                <Button type="button" size="sm" variant="outline" onClick={addRetryStore} disabled={!newRetryName.trim() || !newRetryPhone.trim()} className="h-8 px-2 shrink-0">
                                  <Plus className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>

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
                      </>
                    )}
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
                    {retryAttempt > 0 && (
                      <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Retry #{retryAttempt}
                      </Badge>
                    )}
                    {retryQueue.length > 0 && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {retryQueue.length} backup{retryQueue.length > 1 ? 's' : ''} left
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      <MessageSquare className="w-3 h-3 mr-1" />
                      Turn {activeCall?.turnCount || 0}
                    </Badge>
                    <Badge variant={isCallActive ? "default" : "secondary"} className="text-xs">
                      {activeCall?.status}
                    </Badge>
                    {isCallActive && activeCall?.taskId && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 px-2 text-xs gap-1"
                        onClick={() => killCall(activeCall.taskId)}
                      >
                        <PhoneOff className="w-3 h-3" /> Kill
                      </Button>
                    )}
                  </div>
                </div>

                {/* Transcript */}
                <div ref={transcriptRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  {(activeCall?.conversationHistory || []).map((msg, i) => (
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
                  {activeCall && (!activeCall.conversationHistory || activeCall.conversationHistory.length === 0) && (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-3">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Call in progress — waiting for transcript...</span>
                      {activeCall.config?.company_name && (
                        <span className="text-xs">Calling {activeCall.config.company_name}</span>
                      )}
                      {(activeCall as any)?.engine === "elevenlabs-native" && (
                        <span className="text-[10px] text-muted-foreground/60">ElevenLabs handles voice natively · transcript updates every 3s</span>
                      )}
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
              {/* Director Input */}
              {isCallActive && (
                <Card className="bg-card/50 border-border/40">
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-400" /> Director Input
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={injection}
                        onChange={(e) => setInjection(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && injectInstruction()}
                        placeholder="Steer strategy... (e.g., Push for manager)"
                        className="h-8 text-xs bg-muted/30 border-border/40"
                      />
                      <Button
                        onClick={injectInstruction}
                        disabled={!injection.trim() || isInjecting}
                        size="sm"
                        className="h-8 px-2"
                      >
                        {isInjecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Sent instantly and applied on the next turn.</p>
                  </CardContent>
                </Card>
              )}

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

              {/* Director Feed — always visible during active calls */}
              {isCallActive && (
                <Card className="bg-card/50 border-border/40">
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="text-xs font-semibold flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-amber-400" /> Director Feed
                      </span>
                      {activeCall?.pendingInjections > 0 && (
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                          {activeCall.pendingInjections} queued
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-2">
                    {latestDirectorDirective && (
                      <div className="text-xs bg-muted/30 rounded p-2">
                        {latestDirectorDirective}
                      </div>
                    )}
                    {directorHistory.length > 0 && (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {directorHistory.slice(-6).reverse().map((entry, i) => (
                          <div key={`${entry.createdAt || i}-${i}`} className="rounded-md border border-border/40 bg-muted/20 p-2">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                              <span>Turn {entry.turnNumber ?? "—"}</span>
                              <span>{formatPanelTime(entry.createdAt)}</span>
                            </div>
                            <p className="text-[11px] leading-snug">{entry.directive}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Operator Injections — always visible during active calls */}
              {isCallActive && (
                <Card className="bg-card/50 border-border/40">
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-400" /> Operator Injections
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-1.5">
                    {injectionHistory.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">No logged injections yet.</p>
                    ) : (
                      injectionHistory.slice(-6).reverse().map((entry, i) => (
                        <div key={`${entry.createdAt || i}-${entry.instruction}`} className="rounded-md border border-border/40 bg-muted/20 p-2">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                            <span>{formatPanelTime(entry.consumedAt || entry.createdAt)}</span>
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 capitalize">
                              {entry.status || "queued"}
                            </Badge>
                          </div>
                          <p className="text-[11px] leading-snug">{entry.instruction}</p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Call Info / Architecture */}
              {activeCall ? (
                <div className="text-xs space-y-3 p-3 bg-muted/10 rounded-lg">
                  <p className="font-semibold text-foreground">Call Details</p>
                  <div className="space-y-2">
                    {activeCall.config?.objective && (
                      <div>
                        <span className="text-muted-foreground">Objective</span>
                        <p className="mt-0.5">{activeCall.config.objective}</p>
                      </div>
                    )}
                    {activeCall.config?.company_name && (
                      <div>
                        <span className="text-muted-foreground">Company</span>
                        <p className="mt-0.5 font-medium">{activeCall.config.company_name}</p>
                      </div>
                    )}
                    {(activeCall as any)?.engine && (
                      <div>
                        <span className="text-muted-foreground">Engine</span>
                        <p className="mt-0.5 font-mono">{(activeCall as any).engine}</p>
                      </div>
                    )}
                    {(activeCall as any)?.conversationId && (
                      <div>
                        <span className="text-muted-foreground">Conversation</span>
                        <p className="mt-0.5 font-mono text-[10px] break-all">{(activeCall as any).conversationId}</p>
                      </div>
                    )}
                    {(activeCall as any)?.elStatus && (
                      <div>
                        <span className="text-muted-foreground">ElevenLabs Status</span>
                        <Badge variant="outline" className="ml-2 text-[10px]">{(activeCall as any).elStatus}</Badge>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground space-y-3 p-3 bg-muted/10 rounded-lg">
                  <p className="font-semibold text-foreground">Voice Pipeline</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center">
                        <Zap className="w-3 h-3 text-amber-400" />
                      </div>
                      <span>You → inject instructions</span>
                    </div>
                    <div className="w-px h-3 bg-border/50 ml-2.5" />
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">
                        <Brain className="w-3 h-3 text-purple-400" />
                      </div>
                      <span>ElevenLabs → handles voice natively</span>
                    </div>
                    <div className="w-px h-3 bg-border/50 ml-2.5" />
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center">
                        <Phone className="w-3 h-3 text-emerald-400" />
                      </div>
                      <span>Maya → speaks naturally</span>
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
