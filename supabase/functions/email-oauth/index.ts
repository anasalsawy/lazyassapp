import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// OAuth configuration for Gmail and Outlook
const OAUTH_CONFIG = {
  gmail: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: {
      read: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/userinfo.email"],
      send: ["https://www.googleapis.com/auth/gmail.send"],
    },
  },
  outlook: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: {
      read: ["Mail.Read", "User.Read", "offline_access"],
      send: ["Mail.Send"],
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // OAuth credentials (to be added as secrets)
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
  const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET");

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const action = pathParts[pathParts.length - 1]; // Last segment

    // For auth-required endpoints, validate JWT
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");

    if (authHeader?.startsWith("Bearer ")) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!error && user?.id) {
        userId = user.id;
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Route: GET /email-oauth/status
    if (req.method === "GET" && action === "status") {
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: connections } = await supabaseAdmin
        .from("email_connections")
        .select("id, provider, email_address, status, last_sync_at, created_at")
        .eq("user_id", userId);

      const { data: settings } = await supabaseAdmin
        .from("email_agent_settings")
        .select("*")
        .eq("user_id", userId)
        .single();

      return new Response(
        JSON.stringify({
          connections: connections || [],
          settings: settings || {
            enabled: false,
            read_emails: true,
            auto_create_drafts: true,
            allow_sending: false,
            send_mode: "draft_only",
          },
          oauth_available: {
            gmail: !!GOOGLE_CLIENT_ID,
            outlook: !!MICROSOFT_CLIENT_ID,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: POST /email-oauth/connect/:provider/start
    if (req.method === "POST" && action === "start") {
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { provider, includeSend = false, redirectUri } = await req.json();

      if (!["gmail", "outlook"].includes(provider)) {
        return new Response(JSON.stringify({ error: "Invalid provider" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const config = OAUTH_CONFIG[provider as keyof typeof OAUTH_CONFIG];
      let clientId: string | undefined;

      if (provider === "gmail") {
        clientId = GOOGLE_CLIENT_ID;
        if (!clientId) {
          return new Response(
            JSON.stringify({ error: "Gmail OAuth not configured. Please add GOOGLE_CLIENT_ID secret." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        clientId = MICROSOFT_CLIENT_ID;
        if (!clientId) {
          return new Response(
            JSON.stringify({ error: "Outlook OAuth not configured. Please add MICROSOFT_CLIENT_ID secret." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Build scopes
      const scopes = [...config.scopes.read];
      if (includeSend) {
        scopes.push(...config.scopes.send);
      }

      // Generate state token for security
      const state = crypto.randomUUID();

      // Store state temporarily (expires in 10 minutes)
      await supabaseAdmin.from("agent_logs").insert({
        user_id: userId,
        agent_name: "email_oauth",
        log_level: "info",
        message: "OAuth flow initiated",
        metadata: {
          state,
          provider,
          redirect_uri: redirectUri,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
      });

      // Build auth URL
      const authParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri || `${supabaseUrl}/functions/v1/email-oauth/callback`,
        response_type: "code",
        scope: scopes.join(" "),
        state: `${userId}:${provider}:${state}`,
        access_type: "offline",
        prompt: "consent",
      });

      const authUrl = `${config.authUrl}?${authParams.toString()}`;

      return new Response(
        JSON.stringify({ authUrl, state }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: GET /email-oauth/callback (OAuth callback)
    if (req.method === "GET" && action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        return new Response(
          `<html><body><script>window.opener.postMessage({type:'oauth_error',error:'${error}'},'*');window.close();</script></body></html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }

      if (!code || !state) {
        return new Response(
          `<html><body><script>window.opener.postMessage({type:'oauth_error',error:'missing_params'},'*');window.close();</script></body></html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }

      // Parse state
      const [stateUserId, provider, stateToken] = state.split(":");

      if (!stateUserId || !provider || !stateToken) {
        return new Response(
          `<html><body><script>window.opener.postMessage({type:'oauth_error',error:'invalid_state'},'*');window.close();</script></body></html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }

      // Exchange code for tokens
      const config = OAUTH_CONFIG[provider as keyof typeof OAUTH_CONFIG];
      const clientId = provider === "gmail" ? GOOGLE_CLIENT_ID : MICROSOFT_CLIENT_ID;
      const clientSecret = provider === "gmail" ? GOOGLE_CLIENT_SECRET : MICROSOFT_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return new Response(
          `<html><body><script>window.opener.postMessage({type:'oauth_error',error:'oauth_not_configured'},'*');window.close();</script></body></html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }

      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${supabaseUrl}/functions/v1/email-oauth/callback`,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Token exchange failed:", errorText);
        return new Response(
          `<html><body><script>window.opener.postMessage({type:'oauth_error',error:'token_exchange_failed'},'*');window.close();</script></body></html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }

      const tokens = await tokenResponse.json();

      // Get user email from the provider
      let userEmail = "";
      if (provider === "gmail") {
        const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userInfoResponse.ok) {
          const userInfo = await userInfoResponse.json();
          userEmail = userInfo.email;
        }
      } else {
        const userInfoResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userInfoResponse.ok) {
          const userInfo = await userInfoResponse.json();
          userEmail = userInfo.mail || userInfo.userPrincipalName;
        }
      }

      if (!userEmail) {
        return new Response(
          `<html><body><script>window.opener.postMessage({type:'oauth_error',error:'failed_to_get_email'},'*');window.close();</script></body></html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }

      // Store connection (tokens encrypted - in production use proper encryption)
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;

      const { error: upsertError } = await supabaseAdmin.from("email_connections").upsert(
        {
          user_id: stateUserId,
          provider,
          email_address: userEmail,
          access_token_enc: tokens.access_token, // In production: encrypt this
          refresh_token_enc: tokens.refresh_token, // In production: encrypt this
          expires_at: expiresAt,
          status: "connected",
          scopes_json: tokens.scope?.split(" ") || [],
        },
        { onConflict: "user_id,provider,email_address" }
      );

      if (upsertError) {
        console.error("Failed to store connection:", upsertError);
        return new Response(
          `<html><body><script>window.opener.postMessage({type:'oauth_error',error:'storage_failed'},'*');window.close();</script></body></html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }

      // Ensure email settings exist
      await supabaseAdmin.from("email_agent_settings").upsert(
        { user_id: stateUserId },
        { onConflict: "user_id" }
      );

      // Log success
      await supabaseAdmin.from("agent_logs").insert({
        user_id: stateUserId,
        agent_name: "email_oauth",
        log_level: "info",
        message: `Successfully connected ${provider} account: ${userEmail}`,
        metadata: { provider, email: userEmail },
      });

      return new Response(
        `<html><body><script>window.opener.postMessage({type:'oauth_success',provider:'${provider}',email:'${userEmail}'},'*');window.close();</script></body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // Route: POST /email-oauth/disconnect
    if (req.method === "POST" && action === "disconnect") {
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { provider, connectionId } = await req.json();

      const { error: deleteError } = await supabaseAdmin
        .from("email_connections")
        .update({ status: "disconnected", access_token_enc: null, refresh_token_enc: null })
        .eq("user_id", userId)
        .eq("id", connectionId);

      if (deleteError) {
        return new Response(JSON.stringify({ error: "Failed to disconnect" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: POST /email-oauth/settings
    if (req.method === "POST" && action === "settings") {
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const settings = await req.json();

      const { error: upsertError } = await supabaseAdmin
        .from("email_agent_settings")
        .upsert(
          {
            user_id: userId,
            ...settings,
          },
          { onConflict: "user_id" }
        );

      if (upsertError) {
        return new Response(JSON.stringify({ error: "Failed to update settings" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Email OAuth error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
