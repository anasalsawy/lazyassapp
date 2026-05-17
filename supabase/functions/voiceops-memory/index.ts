// VoiceOps Memory API — public HTTP endpoint for Vapi tools to read/write callers, reservations, bookings.
// Auth: requires header `x-api-key: <VOICEOPS_MEMORY_KEY>` on all write/read calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = (Deno.env.get("VOICEOPS_MEMORY_KEY") || "").trim();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normPhone(p: string) {
  const s = String(p || "").trim().replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (/^\d{10}$/.test(s)) return `+1${s}`;
  if (/^1\d{10}$/.test(s)) return `+${s}`;
  return `+${s}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // API key check
  if (API_KEY) {
    const got = req.headers.get("x-api-key") || "";
    if (got !== API_KEY) return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  // Path after /functions/v1/voiceops-memory
  const path = url.pathname.replace(/^.*\/voiceops-memory/, "").replace(/\/+$/, "") || "/";
  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // ---------- CALLERS ----------
    // GET /callers?phone=+15551234567  → fetch caller + recent reservations/bookings
    if (path === "/callers" && req.method === "GET") {
      const phone = normPhone(url.searchParams.get("phone") || "");
      if (!phone) return json({ error: "phone required" }, 400);
      const { data: caller } = await db.from("voiceops_callers").select("*").eq("phone_number", phone).maybeSingle();
      const { data: reservations } = await db.from("voiceops_reservations").select("*").eq("phone_number", phone).order("created_at", { ascending: false }).limit(10);
      const { data: bookings } = await db.from("voiceops_bookings").select("*").eq("phone_number", phone).order("created_at", { ascending: false }).limit(10);
      return json({ caller, reservations: reservations ?? [], bookings: bookings ?? [] });
    }

    // POST /callers  → upsert caller (body: { phone_number, name?, email?, notes?, tags?, metadata? })
    if (path === "/callers" && req.method === "POST") {
      const body = await req.json();
      const phone = normPhone(body.phone_number);
      if (!phone) return json({ error: "phone_number required" }, 400);
      const row = {
        phone_number: phone,
        name: body.name ?? null,
        email: body.email ?? null,
        notes: body.notes ?? null,
        tags: body.tags ?? [],
        metadata: body.metadata ?? {},
        last_call_at: body.touch_call ? new Date().toISOString() : undefined,
      };
      const { data, error } = await db
        .from("voiceops_callers")
        .upsert(row, { onConflict: "phone_number" })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      if (body.touch_call) {
        await db.rpc("increment_caller_count", {}).catch(() => {});
        await db.from("voiceops_callers").update({ call_count: (data.call_count ?? 0) + 1 }).eq("id", data.id);
      }
      return json({ caller: data });
    }

    // ---------- RESERVATIONS ----------
    // GET /reservations?phone=&status=
    if (path === "/reservations" && req.method === "GET") {
      let q = db.from("voiceops_reservations").select("*").order("reservation_at", { ascending: true });
      const phone = url.searchParams.get("phone");
      const status = url.searchParams.get("status");
      if (phone) q = q.eq("phone_number", normPhone(phone));
      if (status) q = q.eq("status", status);
      const { data, error } = await q.limit(100);
      if (error) return json({ error: error.message }, 500);
      return json({ reservations: data });
    }

    // POST /reservations  → create
    if (path === "/reservations" && req.method === "POST") {
      const body = await req.json();
      const phone = normPhone(body.phone_number);
      if (!phone) return json({ error: "phone_number required" }, 400);
      const { data, error } = await db.from("voiceops_reservations").insert({
        phone_number: phone,
        customer_name: body.customer_name ?? null,
        party_size: body.party_size ?? null,
        reservation_at: body.reservation_at ?? null,
        status: body.status ?? "pending",
        notes: body.notes ?? null,
        metadata: body.metadata ?? {},
        vapi_call_id: body.vapi_call_id ?? null,
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ reservation: data });
    }

    // PATCH /reservations/:id
    const resMatch = path.match(/^\/reservations\/([0-9a-f-]+)$/i);
    if (resMatch && req.method === "PATCH") {
      const body = await req.json();
      const { data, error } = await db.from("voiceops_reservations").update(body).eq("id", resMatch[1]).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ reservation: data });
    }
    if (resMatch && req.method === "DELETE") {
      const { error } = await db.from("voiceops_reservations").delete().eq("id", resMatch[1]);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ---------- BOOKINGS ----------
    if (path === "/bookings" && req.method === "GET") {
      let q = db.from("voiceops_bookings").select("*").order("scheduled_at", { ascending: true });
      const phone = url.searchParams.get("phone");
      const status = url.searchParams.get("status");
      const type = url.searchParams.get("type");
      if (phone) q = q.eq("phone_number", normPhone(phone));
      if (status) q = q.eq("status", status);
      if (type) q = q.eq("booking_type", type);
      const { data, error } = await q.limit(100);
      if (error) return json({ error: error.message }, 500);
      return json({ bookings: data });
    }

    if (path === "/bookings" && req.method === "POST") {
      const body = await req.json();
      const phone = normPhone(body.phone_number);
      if (!phone) return json({ error: "phone_number required" }, 400);
      if (!body.booking_type) return json({ error: "booking_type required" }, 400);
      const { data, error } = await db.from("voiceops_bookings").insert({
        phone_number: phone,
        customer_name: body.customer_name ?? null,
        booking_type: body.booking_type,
        scheduled_at: body.scheduled_at ?? null,
        status: body.status ?? "pending",
        details: body.details ?? {},
        notes: body.notes ?? null,
        vapi_call_id: body.vapi_call_id ?? null,
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ booking: data });
    }

    const bookMatch = path.match(/^\/bookings\/([0-9a-f-]+)$/i);
    if (bookMatch && req.method === "PATCH") {
      const body = await req.json();
      const { data, error } = await db.from("voiceops_bookings").update(body).eq("id", bookMatch[1]).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ booking: data });
    }
    if (bookMatch && req.method === "DELETE") {
      const { error } = await db.from("voiceops_bookings").delete().eq("id", bookMatch[1]);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ---------- HEALTH ----------
    if (path === "/" || path === "/health") {
      return json({ ok: true, service: "voiceops-memory", endpoints: [
        "GET  /callers?phone=",
        "POST /callers",
        "GET  /reservations?phone=&status=",
        "POST /reservations",
        "PATCH /reservations/:id",
        "DELETE /reservations/:id",
        "GET  /bookings?phone=&status=&type=",
        "POST /bookings",
        "PATCH /bookings/:id",
        "DELETE /bookings/:id",
      ]});
    }

    return json({ error: "not_found", path, method: req.method }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
