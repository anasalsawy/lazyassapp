import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Monitor, Plus, Trash2, Copy, Activity } from "lucide-react";

interface VM {
  id: string;
  name: string;
  host: string;
  ssh_port: number;
  ssh_user: string;
  novnc_url: string | null;
  status: string;
  last_heartbeat_at: string | null;
}

export default function VMs() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [vms, setVMs] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "",
    host: "",
    ssh_port: "22",
    ssh_user: "root",
    ssh_key: "",
    novnc_url: "",
    bridge_port: "8022",
  });

  const callBridge = async (action: string, body?: any) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vm-bridge?action=${action}`;
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const loadVMs = async () => {
    try {
      const data = await callBridge("list");
      setVMs(data.vms || []);
    } catch (e: any) {
      toast({ title: "Failed to load VMs", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) loadVMs();
  }, [session]);

  const addVM = async () => {
    if (!form.name || !form.host) {
      toast({ title: "Name and host required", variant: "destructive" });
      return;
    }
    setAdding(true);
    try {
      await callBridge("add", {
        name: form.name,
        host: form.host,
        ssh_port: parseInt(form.ssh_port) || 22,
        ssh_user: form.ssh_user,
        ssh_key_enc: form.ssh_key || null,
        noVNC_url: form.novnc_url || null,
        os: "linux",
        specs_json: { bridge_port: parseInt(form.bridge_port) || 8022 },
      });
      toast({ title: "VM registered", description: "Manus can now control it." });
      setForm({ name: "", host: "", ssh_port: "22", ssh_user: "root", ssh_key: "", novnc_url: "", bridge_port: "8022" });
      loadVMs();
    } catch (e: any) {
      toast({ title: "Add failed", description: e.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const removeVM = async (vm_id: string) => {
    if (!confirm("Remove this VM?")) return;
    try {
      await callBridge("remove", { vm_id });
      loadVMs();
    } catch (e: any) {
      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
    }
  };

  const pingVM = async (vm_id: string) => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vm-bridge?action=status&vm_id=${vm_id}`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      const data = await res.json();
      toast({
        title: `${data.name}: ${data.status}`,
        description: data.status === "online" ? "Bridge reachable ✓" : "Bridge not responding on port 8022",
        variant: data.status === "online" ? "default" : "destructive",
      });
      loadVMs();
    } catch (e: any) {
      toast({ title: "Ping failed", description: e.message, variant: "destructive" });
    }
  };

  const installScript = `# Run this on your VM (Linux) to install the Manus bridge agent
curl -fsSL https://raw.githubusercontent.com/lovable-dev/vm-bridge/main/install.sh | bash
# Or manually run a tiny HTTP server on port 8022 with API key auth.
# Required env: BRIDGE_API_KEY=<value from Lovable secrets>`;

  return (
    <AppLayout>
      <div className="container max-w-4xl py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold flex items-center gap-3">
            <Monitor className="w-8 h-8 text-primary" /> My VMs
          </h1>
          <p className="text-muted-foreground mt-1">
            Wire your VMs into Manus. Requires the bridge agent on port 8022.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5" /> Register a VM</CardTitle>
            <CardDescription>
              Manus controls VMs via an HTTP bridge. Make sure your VM is running the bridge on the port below before adding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-vm-1" />
              </div>
              <div>
                <Label>Host / IP</Label>
                <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="1.2.3.4" />
              </div>
              <div>
                <Label>SSH Port</Label>
                <Input value={form.ssh_port} onChange={(e) => setForm({ ...form, ssh_port: e.target.value })} />
              </div>
              <div>
                <Label>SSH User</Label>
                <Input value={form.ssh_user} onChange={(e) => setForm({ ...form, ssh_user: e.target.value })} />
              </div>
              <div>
                <Label>Bridge Port</Label>
                <Input value={form.bridge_port} onChange={(e) => setForm({ ...form, bridge_port: e.target.value })} />
              </div>
              <div>
                <Label>noVNC URL (optional)</Label>
                <Input value={form.novnc_url} onChange={(e) => setForm({ ...form, novnc_url: e.target.value })} placeholder="https://..." />
              </div>
            </div>
            <div>
              <Label>SSH Private Key (optional, for reference)</Label>
              <Textarea
                value={form.ssh_key}
                onChange={(e) => setForm({ ...form, ssh_key: e.target.value })}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                className="font-mono text-xs h-32"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Stored encrypted. Manus uses the HTTP bridge for execution; SSH key is metadata only.
              </p>
            </div>
            <Button onClick={addVM} disabled={adding} className="w-full">
              {adding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Register VM
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bridge Install (run once on the VM)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">{installScript}</pre>
              <Button
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={() => { navigator.clipboard.writeText(installScript); toast({ title: "Copied" }); }}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              The bridge must accept POST /exec, GET /health, GET /screenshot with header <code>X-API-Key</code> matching the <code>BRIDGE_API_KEY</code> secret.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registered VMs ({vms.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : vms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No VMs yet. Register one above.</p>
            ) : (
              <div className="space-y-2">
                {vms.map((vm) => (
                  <div key={vm.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{vm.name}</span>
                        <Badge variant={vm.status === "online" ? "default" : "secondary"}>
                          {vm.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">
                        {vm.ssh_user}@{vm.host}:{vm.ssh_port}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => pingVM(vm.id)}>
                        <Activity className="w-3 h-3 mr-1" /> Ping
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeVM(vm.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
