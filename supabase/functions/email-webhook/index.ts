import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// This webhook receives incoming emails from Mailgun
// and stores them in the database with AI analysis

// Verify Mailgun webhook signature (optional but recommended for production)
async function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  apiKey: string
): Promise<boolean> {
  try {
    const data = timestamp + token;
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      encoder.encode(apiKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(data));
    const hexSig = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return hexSig === signature;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const MAILGUN_API_KEY = Deno.env.get("MAILGUN_API_KEY");
  const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN");

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    let emailData: any;

    // Handle different content types (Mailgun sends multipart/form-data)
    const contentType = req.headers.get("content-type") || "";
    
    if (contentType.includes("application/json")) {
      emailData = await req.json();
    } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      // Handle form data (Mailgun webhook format)
      const formData = await req.formData();
      emailData = Object.fromEntries(formData.entries());
    } else {
      throw new Error("Unsupported content type");
    }

    console.log("[EmailWebhook] Received Mailgun webhook:", JSON.stringify(emailData).substring(0, 500));

    // Optional: Verify Mailgun signature for security
    if (MAILGUN_API_KEY && emailData.signature) {
      const { timestamp, token, signature } = emailData.signature || {};
      if (timestamp && token && signature) {
        const isValid = await verifyMailgunSignature(timestamp, token, signature, MAILGUN_API_KEY);
        if (!isValid) {
          console.warn("[EmailWebhook] Invalid Mailgun signature");
          // In production, you might want to reject invalid signatures
        }
      }
    }

    // Extract email fields (adapt based on provider)
    // This handles Mailgun, SendGrid, and generic formats
    const fromEmail = emailData.from || emailData.sender || emailData["from-email"] || "";
    const fromName = emailData["from-name"] || extractName(fromEmail);
    const toEmail = emailData.to || emailData.recipient || emailData["to-email"] || "";
    const subject = emailData.subject || emailData.Subject || "(No Subject)";
    const bodyText = emailData["body-plain"] || emailData.text || emailData.body || "";
    const bodyHtml = emailData["body-html"] || emailData.html || "";
    const receivedAt = emailData.timestamp 
      ? new Date(parseInt(emailData.timestamp) * 1000).toISOString()
      : new Date().toISOString();

    // Find user by email address
    const { data: emailAccount } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("email_address", extractEmail(toEmail))
      .single();

    if (!emailAccount) {
      console.log("No matching email account found for:", toEmail);
      return new Response(
        JSON.stringify({ success: true, message: "Email received but no matching account" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to match to an existing application
    let matchedApplicationId = null;
    const { data: applications } = await supabase
      .from("applications")
      .select(`
        id,
        job:jobs(company, title)
      `)
      .eq("user_id", emailAccount.user_id);

    // Check if email is from a company we applied to
    if (applications) {
      for (const app of applications) {
        const companyName = (app.job as any)?.company?.toLowerCase() || "";
        const senderDomain = extractEmail(fromEmail).split("@")[1]?.toLowerCase() || "";
        const senderName = fromName.toLowerCase();
        
        if (companyName && (
          senderDomain.includes(companyName.split(" ")[0]) ||
          senderName.includes(companyName.split(" ")[0])
        )) {
          matchedApplicationId = app.id;
          break;
        }
      }
    }

    // Analyze email with AI
    let aiSummary = null;
    let aiSentiment = null;
    let aiSuggestedReply = null;

    if (LOVABLE_API_KEY && bodyText) {
      try {
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content: `You are an Email Agent analyzing recruiter emails. Analyze this email and return JSON:

{
  "summary": string (2-3 sentence summary),
  "sentiment": "positive" | "neutral" | "negative" | "rejection" | "interview_request",
  "suggestedReply": string | null (brief suggested reply if response is needed),
  "isUrgent": boolean,
  "actionRequired": string | null (what action the candidate should take)
}

Sentiment guidelines:
- "interview_request": mentions scheduling interview, phone screen, meeting
- "positive": positive feedback, moving forward, interest expressed
- "rejection": position filled, not moving forward, application declined
- "negative": concerning feedback
- "neutral": acknowledgement, automated response, information request`,
              },
              {
                role: "user",
                content: `From: ${fromName} <${fromEmail}>
Subject: ${subject}

${bodyText.substring(0, 2000)}`,
              },
            ],
            temperature: 0.3,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const analysis = JSON.parse(jsonMatch[0]);
              aiSummary = analysis.summary;
              aiSentiment = analysis.sentiment;
              aiSuggestedReply = analysis.suggestedReply;
            }
          } catch {
            console.error("Failed to parse AI analysis");
          }
        }
      } catch (err) {
        console.error("AI analysis failed:", err);
      }
    }

    // Extract verification code if present
    const verificationCode = extractVerificationCode(subject + " " + bodyText);
    const isVerificationEmail = !!verificationCode || 
      /verify|verification|confirm|code|otp|one-time|security code/i.test(subject + " " + bodyText.substring(0, 500));

    if (verificationCode) {
      console.log(`[EmailWebhook] Extracted verification code: ${verificationCode}`);
    }

    // Store the email
    const { data: savedEmail, error } = await supabase
      .from("incoming_emails")
      .insert({
        user_id: emailAccount.user_id,
        email_account_id: emailAccount.id,
        application_id: matchedApplicationId,
        from_email: extractEmail(fromEmail),
        from_name: fromName,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        is_read: false,
        ai_summary: aiSummary,
        ai_sentiment: aiSentiment,
        ai_suggested_reply: aiSuggestedReply,
        received_at: receivedAt,
        verification_code: verificationCode,
        is_verification_email: isVerificationEmail,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Update application status if relevant
    if (matchedApplicationId && aiSentiment) {
      let newStatus = null;
      if (aiSentiment === "interview_request") {
        newStatus = "interview";
      } else if (aiSentiment === "rejection") {
        newStatus = "rejected";
      } else if (aiSentiment === "positive") {
        newStatus = "under_review";
      }

      if (newStatus) {
        await supabase
          .from("applications")
          .update({ 
            status: newStatus,
            response_at: new Date().toISOString(),
            notes: `Status updated based on email: "${subject}"`,
          })
          .eq("id", matchedApplicationId);
      }
    }

    // Update last synced
    await supabase
      .from("email_accounts")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", emailAccount.id);

    // Log activity
    await supabase.from("agent_logs").insert({
      user_id: emailAccount.user_id,
      agent_name: "email_agent",
      log_level: "info",
      message: `Email received: "${subject}" from ${fromName}`,
      metadata: {
        email_id: savedEmail.id,
        sentiment: aiSentiment,
        matched_application: matchedApplicationId,
      },
    });

    console.log("Email processed successfully:", savedEmail.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        email_id: savedEmail.id,
        sentiment: aiSentiment,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Email webhook error:", error);
    const message = error instanceof Error ? error.message : "Failed to process email";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/);
  return match ? match[1] : str.trim();
}

function extractName(str: string): string {
  const match = str.match(/^([^<]+)</);
  return match ? match[1].trim() : str.split("@")[0];
}

// Extract verification/OTP codes from email content
function extractVerificationCode(text: string): string | null {
  // Common patterns for verification codes
  const patterns = [
    // 6-8 digit codes (most common)
    /\b(?:code|pin|otp|verification)[:\s]+(\d{6,8})\b/i,
    /\b(\d{6,8})\s*(?:is your|verification|code|pin)\b/i,
    // Codes in special formatting
    /verification code[:\s]*\**([A-Z0-9]{6,8})\**/i,
    /security code[:\s]*\**([A-Z0-9]{6,8})\**/i,
    // Standalone 6-8 character alphanumeric codes on their own line
    /^\s*([A-Z0-9]{6,8})\s*$/im,
    // Codes with dashes
    /\b([A-Z0-9]{3,4}-[A-Z0-9]{3,4})\b/i,
    // Generic "Your code is: XXXXXX"
    /your (?:code|pin|otp) (?:is[:\s]*)?([A-Z0-9]{4,8})/i,
    // "Enter XXXXXX to verify"
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
