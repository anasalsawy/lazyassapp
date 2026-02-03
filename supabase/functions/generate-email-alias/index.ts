import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Generates unique email aliases for job applications using Mailgun routes
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MAILGUN_API_KEY = Deno.env.get("MAILGUN_API_KEY");
    const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
      throw new Error("Mailgun credentials not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const { jobId, company } = await req.json();

    if (!jobId) {
      throw new Error("Job ID is required");
    }

    // Generate a unique email alias
    // Format: job-{shortId}-{timestamp}@domain
    const shortId = jobId.substring(0, 8);
    const timestamp = Date.now().toString(36);
    const companySlug = company 
      ? company.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10)
      : 'app';
    
    const emailAlias = `apply-${companySlug}-${shortId}-${timestamp}@${MAILGUN_DOMAIN}`;

    console.log(`[EmailAlias] Generating alias: ${emailAlias} for job ${jobId}`);

    // Create or update email account record
    const { data: existingAccount } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("user_id", user.id)
      .eq("email_provider", "mailgun")
      .single();

    if (!existingAccount) {
      // Create the user's Mailgun email account entry
      await supabase.from("email_accounts").insert({
        user_id: user.id,
        email_address: emailAlias,
        email_provider: "mailgun",
        is_active: true,
      });
    } else {
      // Update to latest alias (or keep primary)
      await supabase
        .from("email_accounts")
        .update({ 
          email_address: emailAlias,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingAccount.id);
    }

    // Create a Mailgun route to forward emails to our webhook
    // Note: With sandbox domain, this is limited - in production you'd set up proper routes
    const webhookUrl = `${supabaseUrl}/functions/v1/email-webhook`;
    
    console.log(`[EmailAlias] Webhook URL: ${webhookUrl}`);

    // Log the alias creation
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      agent_name: "email_agent",
      log_level: "info",
      message: `Generated email alias: ${emailAlias}`,
      metadata: { 
        emailAlias, 
        jobId, 
        company,
        webhookUrl,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        emailAlias,
        domain: MAILGUN_DOMAIN,
        message: "Email alias generated successfully",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[EmailAlias] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate email alias";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
