// Shared Duffel API client for edge functions
export const DUFFEL_BASE = "https://api.duffel.com";
export const DUFFEL_VERSION = "v2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function duffelHeaders() {
  const key = Deno.env.get("DUFFEL_API_KEY");
  if (!key) throw new Error("DUFFEL_API_KEY not configured");
  return {
    Authorization: `Bearer ${key}`,
    "Duffel-Version": DUFFEL_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function duffel(
  path: string,
  init: { method?: string; body?: any; query?: Record<string, any> } = {}
) {
  let url = `${DUFFEL_BASE}${path}`;
  if (init.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((item) => params.append(k, String(item)));
      else params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: duffelHeaders(),
    body: init.body ? JSON.stringify({ data: init.body }) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || json?.errors?.[0]?.title || `Duffel ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(err: any, fallbackStatus = 500) {
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : fallbackStatus;
  return jsonResponse(
    { error: err?.message || "Unknown error", detail: err?.body ?? null },
    status
  );
}
