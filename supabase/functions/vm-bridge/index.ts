import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const internalUserId = req.headers.get("X-User-Id");
    let userId = internalUserId && token === serviceKey ? internalUserId : null;
    if (!userId) {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) throw new Error("Unauthorized");
      userId = user.id;
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "execute";

    if (action === "list") {
      const { data, error } = await supabase.from("vm_instances")
        .select("id, name, host, ssh_port, ssh_user, vnc_url, novnc_url, status, os, specs_json, last_heartbeat_at")
        .eq("user_id", userId)
        .order("name");
      if (error) throw error;
      return new Response(JSON.stringify({ vms: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "add") {
      const body = await req.json();
      const { data, error } = await supabase.from("vm_instances").insert({
        user_id: userId,
        name: body.name,
        host: body.host,
        ssh_port: body.ssh_port || 22,
        ssh_user: body.ssh_user || "admin",
        ssh_password_enc: body.ssh_password_enc || null,
        ssh_key_enc: body.ssh_key_enc || null,
        vnc_url: body.vnc_url || null,
        novnc_url: body.noVNC_url || body.novnc_url || null,
        os: body.os || "windows_11",
        specs_json: body.specs_json || {},
        status: "offline",
      }).select().single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, vm: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "remove") {
      const body = await req.json();
      const { error } = await supabase.from("vm_instances")
        .delete().eq("id", body.vm_id).eq("user_id", userId);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "execute") {
      const body = await req.json();
      const { vm_id, command } = body;

      // Get VM details
      const { data: vm, error: vmErr } = await supabase.from("vm_instances")
        .select("*").eq("id", vm_id).eq("user_id", user.id).single();
      if (vmErr || !vm) throw new Error("VM not found");

      // Call the VM's SSH bridge endpoint
      // Each VM should run a lightweight HTTP agent that accepts commands
      // Bridge URL pattern: http://{host}:{bridge_port}/exec
      const bridgePort = (vm.specs_json as any)?.bridge_port || 8022;
      const bridgeUrl = `http://${vm.host}:${bridgePort}/exec`;
      const BRIDGE_API_KEY = Deno.env.get("VM_BRIDGE_API_KEY") || Deno.env.get("BRIDGE_API_KEY") || "";

      const execRes = await fetch(bridgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": BRIDGE_API_KEY,
        },
        body: JSON.stringify({
          command,
          shell: "powershell",
          timeout: body.timeout || 30,
        }),
      });

      const result = await execRes.json();

      // Log the command
      await supabase.from("vm_command_logs").insert({
        user_id: user.id,
        vm_id,
        command,
        output: result.output || result.stdout || JSON.stringify(result),
        exit_code: result.exit_code ?? result.exitCode ?? null,
        duration_ms: result.duration_ms || null,
      });

      // Update heartbeat
      await supabase.from("vm_instances")
        .update({ last_heartbeat_at: new Date().toISOString(), status: "online" })
        .eq("id", vm_id);

      return new Response(JSON.stringify({
        success: true,
        output: result.output || result.stdout || "",
        error_output: result.stderr || "",
        exit_code: result.exit_code ?? result.exitCode ?? 0,
        duration_ms: result.duration_ms || null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "status") {
      const vmId = url.searchParams.get("vm_id");
      if (!vmId) throw new Error("vm_id required");

      const { data: vm, error } = await supabase.from("vm_instances")
        .select("*").eq("id", vmId).eq("user_id", user.id).single();
      if (error || !vm) throw new Error("VM not found");

      // Try to ping the bridge
      const bridgePort = (vm.specs_json as any)?.bridge_port || 8022;
      const bridgeUrl = `http://${vm.host}:${bridgePort}/health`;
      let online = false;
      try {
        const pingRes = await fetch(bridgeUrl, { signal: AbortSignal.timeout(5000) });
        online = pingRes.ok;
      } catch { /* offline */ }

      if (online !== (vm.status === "online")) {
        await supabase.from("vm_instances")
          .update({ status: online ? "online" : "offline", last_heartbeat_at: online ? new Date().toISOString() : vm.last_heartbeat_at })
          .eq("id", vmId);
      }

      return new Response(JSON.stringify({
        vm_id: vmId,
        name: vm.name,
        status: online ? "online" : "offline",
        host: vm.host,
        noVNC_url: vm.novnc_url,
        last_heartbeat_at: vm.last_heartbeat_at,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "screenshot") {
      const body = await req.json();
      const { vm_id } = body;

      const { data: vm, error } = await supabase.from("vm_instances")
        .select("*").eq("id", vm_id).eq("user_id", user.id).single();
      if (error || !vm) throw new Error("VM not found");

      const bridgePort = (vm.specs_json as any)?.bridge_port || 8022;
      const bridgeUrl = `http://${vm.host}:${bridgePort}/screenshot`;
      const BRIDGE_API_KEY = Deno.env.get("VM_BRIDGE_API_KEY") || Deno.env.get("BRIDGE_API_KEY") || "";

      const res = await fetch(bridgeUrl, {
        headers: { "X-API-Key": BRIDGE_API_KEY },
      });

      if (!res.ok) throw new Error("Screenshot failed");

      const data = await res.json();
      return new Response(JSON.stringify({
        success: true,
        screenshot_base64: data.screenshot || data.image || null,
        timestamp: new Date().toISOString(),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("[vm-bridge]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
