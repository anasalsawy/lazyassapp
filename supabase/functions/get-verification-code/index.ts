import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// This endpoint allows the Browser Use agent to retrieve verification codes
// sent to the application email aliases

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { emailAddress, maxWaitSeconds = 60 } = await req.json();

    if (!emailAddress) {
      throw new Error("emailAddress is required");
    }

    console.log(`[GetVerificationCode] Looking for code sent to: ${emailAddress}`);

    // Poll for verification email (with timeout)
    const startTime = Date.now();
    const pollInterval = 3000; // 3 seconds
    const maxWait = Math.min(maxWaitSeconds, 120) * 1000; // Max 2 minutes

    while (Date.now() - startTime < maxWait) {
      // Find the email account
      const { data: emailAccount } = await supabase
        .from("email_accounts")
        .select("id, user_id")
        .eq("email_address", emailAddress)
        .single();

      if (!emailAccount) {
        console.log(`[GetVerificationCode] No email account found for: ${emailAddress}`);
        // Wait and retry - the webhook might not have processed yet
        await new Promise(r => setTimeout(r, pollInterval));
        continue;
      }

      // Look for recent verification emails
      const { data: emails } = await supabase
        .from("incoming_emails")
        .select("id, subject, verification_code, body_text, received_at")
        .eq("email_account_id", emailAccount.id)
        .eq("is_verification_email", true)
        .order("received_at", { ascending: false })
        .limit(5);

      if (emails && emails.length > 0) {
        // Check for one with a code
        const emailWithCode = emails.find(e => e.verification_code);
        
        if (emailWithCode) {
          console.log(`[GetVerificationCode] Found code: ${emailWithCode.verification_code}`);
          
          // Mark as read
          await supabase
            .from("incoming_emails")
            .update({ is_read: true })
            .eq("id", emailWithCode.id);

          return new Response(
            JSON.stringify({
              success: true,
              code: emailWithCode.verification_code,
              subject: emailWithCode.subject,
              receivedAt: emailWithCode.received_at,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // If there's a verification email but no extracted code, try to extract from body
        for (const email of emails) {
          const code = extractVerificationCode(email.subject + " " + (email.body_text || ""));
          if (code) {
            console.log(`[GetVerificationCode] Extracted code from body: ${code}`);
            
            // Update the email with the extracted code
            await supabase
              .from("incoming_emails")
              .update({ verification_code: code, is_read: true })
              .eq("id", email.id);

            return new Response(
              JSON.stringify({
                success: true,
                code: code,
                subject: email.subject,
                receivedAt: email.received_at,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }

      // Wait before next poll
      console.log(`[GetVerificationCode] No code yet, waiting... (${Math.round((Date.now() - startTime) / 1000)}s)`);
      await new Promise(r => setTimeout(r, pollInterval));
    }

    // Timeout - no code found
    console.log(`[GetVerificationCode] Timeout waiting for verification code`);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Timeout waiting for verification code",
        message: "No verification email received within the time limit",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[GetVerificationCode] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to get verification code";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Extract verification/OTP codes from email content
function extractVerificationCode(text: string): string | null {
  const patterns = [
    /\b(?:code|pin|otp|verification)[:\s]+(\d{6,8})\b/i,
    /\b(\d{6,8})\s*(?:is your|verification|code|pin)\b/i,
    /verification code[:\s]*\**([A-Z0-9]{6,8})\**/i,
    /security code[:\s]*\**([A-Z0-9]{6,8})\**/i,
    /^\s*([A-Z0-9]{6,8})\s*$/im,
    /\b([A-Z0-9]{3,4}-[A-Z0-9]{3,4})\b/i,
    /your (?:code|pin|otp) (?:is[:\s]*)?([A-Z0-9]{4,8})/i,
    /enter[:\s]+([A-Z0-9]{4,8})\s+to/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}
