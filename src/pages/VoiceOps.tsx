import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Phone, PhoneOff, Send, Megaphone, Radio } from "lucide-react";

type Call = {
  id: string;
  vapi_call_id: string | null;
  phone_number: string;
  objective: string;
  status: string;
  outcome: string | null;
  recording_url: string | null;
  cost_usd: number | null;
  duration_seconds: number | null;
  ended_reason: string | null;
  created_at: string;
};

type Turn = {
  id: string;
  call_id: string;
  role: string;
  text: string;
  is_final: boolean;
  created_at: string;
};

const ACTIVE = new Set(["queued", "starting", "ringing", "in-progress", "active"]);

export default function VoiceOps() {
  const [phone, setPhone] = useState("");
  const [objective, setObjective] = useState("");
  const [customer, setCustomer] = useState('{\n  "firstName": "",\n  "lastName": "",\n  "company": "",\n  "title": "",\n  "timezone": "",\n  "constraints": "",\n  "offer": ""\n}');
  const [calls, setCalls] = useState<Call[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [injection, setInjection] = useState("");
  const [busy, setBusy] = useState(false);

  // Load calls
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("voiceops_calls")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25);
      setCalls((data ?? []) as Call[]);
      if (!activeId && data?.[0]) setActiveId(data[0].id);
    };
    load();
    const ch = supabase
      .channel("voiceops-calls")
      .on("postgres_changes", { event: "*", schema: "public", table: "voiceops_calls" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Load transcript for active call + realtime
  useEffect(() => {
    if (!activeId) { setTurns([]); return; }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("voiceops_transcripts")
        .select("*")
        .eq("call_id", activeId)
        .order("created_at", { ascending: true });
      if (!cancelled) setTurns((data ?? []) as Turn[]);
    };
    load();
    const ch = supabase
      .channel(`voiceops-turns-${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "voiceops_transcripts", filter: `call_id=eq.${activeId}` },
        (payload) => setTurns((prev) => [...prev, payload.new as Turn]),
      )
      .subscribe();
    // 3s fallback poll
    const interval = setInterval(load, 3000);
    return () => { cancelled = true; supabase.removeChannel(ch); clearInterval(interval); };
  }, [activeId]);

  const activeCall = useMemo(() => calls.find((c) => c.id === activeId), [calls, activeId]);
  const isActiveLive = activeCall && ACTIVE.has(activeCall.status);

  const startCall = async () => {
    if (!phone || !objective) { toast.error("phone + objective required"); return; }
    let customer_info: any = {};
    try { customer_info = customer ? JSON.parse(customer) : {}; } catch { toast.error("customer JSON invalid"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("voiceops-start-call", {
      body: { phone_number: phone, objective, customer_info, max_duration_seconds: 900 },
    });
    setBusy(false);
    if (error || data?.error) { toast.error(error?.message ?? data?.error ?? "failed"); return; }
    toast.success("call placed");
    setActiveId(data.call_id);
  };

  const inject = async (mode: "context" | "say-now" | "end-call") => {
    if (!activeId) return;
    if (mode !== "end-call" && !injection.trim()) { toast.error("type a directive"); return; }
    const { data, error } = await supabase.functions.invoke("voiceops-inject", {
      body: { call_id: activeId, text: injection || "end", mode },
    });
    if (error || data?.error) { toast.error(error?.message ?? data?.error ?? "failed"); return; }
    toast.success(mode === "say-now" ? "said" : mode === "end-call" ? "ended" : "injected");
    if (mode !== "end-call") setInjection("");
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <Radio className="h-7 w-7 text-primary" />
              VoiceOps
            </h1>
            <p className="text-sm text-muted-foreground">Vapi-powered outbound caller — Alex on the line</p>
          </div>
          <Badge variant="outline" className="border-primary/40">Vapi</Badge>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Launch */}
          <Card className="lg:col-span-4 p-5 space-y-4 backdrop-blur bg-card/60 border-border/60">
            <h2 className="font-semibold flex items-center gap-2"><Phone className="h-4 w-4" /> Place Call</h2>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Target phone (E.164)</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Objective</label>
              <Textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Book a 20-min demo with the head of ops for next Tue/Wed"
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Customer info (JSON)</label>
              <Textarea
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                rows={5}
                className="font-mono text-xs"
              />
            </div>
            <Button onClick={startCall} disabled={busy} className="w-full">
              {busy ? "Dialing..." : "Start Call"}
            </Button>
          </Card>

          {/* Live / Transcript */}
          <Card className="lg:col-span-5 p-5 space-y-3 backdrop-blur bg-card/60 border-border/60 flex flex-col">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Live transcript</h2>
              {activeCall && (
                <Badge variant={isActiveLive ? "default" : "secondary"}>
                  {activeCall.status}
                </Badge>
              )}
            </div>
            <div className="flex-1 min-h-[360px] max-h-[480px] overflow-y-auto space-y-2 rounded-md bg-background/40 p-3 border border-border/40">
              {turns.length === 0 && (
                <p className="text-xs text-muted-foreground">No transcript yet.</p>
              )}
              {turns.map((t) => (
                <div key={t.id} className={`text-sm ${t.role === "assistant" ? "text-primary" : "text-foreground"}`}>
                  <span className="text-xs uppercase opacity-60 mr-2">{t.role === "assistant" ? "Alex" : "Them"}</span>
                  {t.text}
                </div>
              ))}
            </div>

            {isActiveLive && (
              <div className="space-y-2 pt-2 border-t border-border/40">
                <Textarea
                  value={injection}
                  onChange={(e) => setInjection(e.target.value)}
                  placeholder="Operator directive (context) or exact words to say..."
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => inject("context")}>
                    <Megaphone className="h-3 w-3 mr-1" /> Inject context
                  </Button>
                  <Button size="sm" onClick={() => inject("say-now")}>
                    <Send className="h-3 w-3 mr-1" /> Say now
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => inject("end-call")} className="ml-auto">
                    <PhoneOff className="h-3 w-3 mr-1" /> End
                  </Button>
                </div>
              </div>
            )}

            {activeCall && !isActiveLive && (
              <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/40">
                {activeCall.outcome && <div><b>Outcome:</b> {activeCall.outcome}</div>}
                {activeCall.ended_reason && <div><b>Ended:</b> {activeCall.ended_reason}</div>}
                {activeCall.recording_url && (
                  <a href={activeCall.recording_url} target="_blank" rel="noreferrer" className="text-primary underline">
                    Listen to recording
                  </a>
                )}
                {activeCall.duration_seconds != null && <div>{activeCall.duration_seconds}s · ${activeCall.cost_usd ?? 0}</div>}
              </div>
            )}
          </Card>

          {/* History */}
          <Card className="lg:col-span-3 p-5 space-y-3 backdrop-blur bg-card/60 border-border/60">
            <h2 className="font-semibold">Recent calls</h2>
            <div className="space-y-2 max-h-[520px] overflow-y-auto">
              {calls.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-left p-2 rounded-md border transition ${
                    c.id === activeId ? "border-primary bg-primary/10" : "border-border/40 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{c.phone_number}</span>
                    <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{c.objective}</p>
                </button>
              ))}
              {calls.length === 0 && <p className="text-xs text-muted-foreground">No calls yet.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
