import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EmailRequest {
  type: "signup" | "magic_link" | "recovery" | "email_change" | "invite";
  email: string;
  token?: string;
  token_hash?: string;
  redirect_to?: string;
  site_url?: string;
  user?: {
    email: string;
    user_metadata?: Record<string, unknown>;
  };
}

const EMAIL_TEMPLATES = {
  signup: {
    subject: "Confirm your email address",
    getHtml: (confirmUrl: string, email: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Your Email</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="min-width: 100%; background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 28px; color: white;">🚀</span>
              </div>
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #18181b;">Welcome to LazyAss!</h1>
              <p style="margin: 0 0 24px; font-size: 16px; color: #71717a;">Confirm your email to start automating your job search.</p>
              
              <a href="${confirmUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; margin-bottom: 24px;">
                Confirm Email Address
              </a>
              
              <p style="margin: 24px 0 0; font-size: 14px; color: #a1a1aa;">
                If you didn't create an account with ${email}, you can safely ignore this email.
              </p>
              
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 32px 0;">
              
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                This link expires in 24 hours. If the button doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #6366f1; word-break: break-all;">
                ${confirmUrl}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },

  magic_link: {
    subject: "Your login link",
    getHtml: (loginUrl: string, email: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Link</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="min-width: 100%; background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 28px; color: white;">🔐</span>
              </div>
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #18181b;">Login to LazyAss</h1>
              <p style="margin: 0 0 24px; font-size: 16px; color: #71717a;">Click the button below to securely log in to your account.</p>
              
              <a href="${loginUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; margin-bottom: 24px;">
                Log In Now
              </a>
              
              <p style="margin: 24px 0 0; font-size: 14px; color: #a1a1aa;">
                If you didn't request this login link for ${email}, you can safely ignore this email.
              </p>
              
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 32px 0;">
              
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                This link expires in 1 hour. If the button doesn't work, copy and paste this URL:
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #6366f1; word-break: break-all;">
                ${loginUrl}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },

  recovery: {
    subject: "Reset your password",
    getHtml: (resetUrl: string, email: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="min-width: 100%; background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #ef4444 0%, #f97316 100%); border-radius: 12px; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 28px; color: white;">🔑</span>
              </div>
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #18181b;">Reset Your Password</h1>
              <p style="margin: 0 0 24px; font-size: 16px; color: #71717a;">We received a request to reset your password.</p>
              
              <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #ef4444 0%, #f97316 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; margin-bottom: 24px;">
                Reset Password
              </a>
              
              <p style="margin: 24px 0 0; font-size: 14px; color: #a1a1aa;">
                If you didn't request a password reset for ${email}, please ignore this email or contact support if you have concerns.
              </p>
              
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 32px 0;">
              
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                This link expires in 1 hour. If the button doesn't work, copy and paste this URL:
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #ef4444; word-break: break-all;">
                ${resetUrl}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },

  email_change: {
    subject: "Confirm your new email address",
    getHtml: (confirmUrl: string, email: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Email Change</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="min-width: 100%; background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%); border-radius: 12px; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 28px; color: white;">✉️</span>
              </div>
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #18181b;">Confirm Email Change</h1>
              <p style="margin: 0 0 24px; font-size: 16px; color: #71717a;">Click below to confirm your new email address.</p>
              
              <a href="${confirmUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; margin-bottom: 24px;">
                Confirm New Email
              </a>
              
              <p style="margin: 24px 0 0; font-size: 14px; color: #a1a1aa;">
                If you didn't request this change for ${email}, please contact support immediately.
              </p>
              
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 32px 0;">
              
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                This link expires in 24 hours.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },

  invite: {
    subject: "You've been invited to LazyAss",
    getHtml: (inviteUrl: string, email: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="min-width: 100%; background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 28px; color: white;">🎉</span>
              </div>
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #18181b;">You're Invited!</h1>
              <p style="margin: 0 0 24px; font-size: 16px; color: #71717a;">Someone invited you to join LazyAss - your AI-powered job search assistant.</p>
              
              <a href="${inviteUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; margin-bottom: 24px;">
                Accept Invitation
              </a>
              
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 32px 0;">
              
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                This invitation was sent to ${email}. If you weren't expecting this, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },
};

async function sendMailgunEmail(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
  const MAILGUN_API_KEY = Deno.env.get("MAILGUN_API_KEY");
  const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN");

  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    throw new Error("Mailgun credentials not configured");
  }

  const formData = new FormData();
  formData.append("from", `LazyAss <noreply@${MAILGUN_DOMAIN}>`);
  formData.append("to", to);
  formData.append("subject", subject);
  formData.append("html", html);

  const response = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Mailgun error:", errorText);
    return { success: false, error: errorText };
  }

  const result = await response.json();
  console.log("Mailgun success:", result);
  return { success: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log("Email agent received payload:", JSON.stringify(payload, null, 2));

    // Handle Supabase Auth webhook format
    const emailType = payload.type || payload.email_action_type;
    const email = payload.email || payload.user?.email;
    const tokenHash = payload.token_hash;
    const redirectTo = payload.redirect_to || payload.site_url || "https://lazyassapp.lovable.app";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://zbbfcxsqfeqnthducdxs.supabase.co";

    if (!email) {
      throw new Error("No email address provided");
    }

    // Build confirmation URL
    let actionUrl = "";
    if (tokenHash) {
      actionUrl = `${supabaseUrl}/auth/v1/verify?token=${tokenHash}&type=${emailType}&redirect_to=${encodeURIComponent(redirectTo)}`;
    } else if (payload.token) {
      actionUrl = `${redirectTo}?token=${payload.token}&type=${emailType}`;
    }

    // Get appropriate template
    const templateKey = emailType as keyof typeof EMAIL_TEMPLATES;
    const template = EMAIL_TEMPLATES[templateKey] || EMAIL_TEMPLATES.signup;

    const html = template.getHtml(actionUrl, email);
    const subject = template.subject;

    // Send email via Mailgun
    const result = await sendMailgunEmail(email, subject, html);

    if (!result.success) {
      throw new Error(result.error || "Failed to send email");
    }

    // Log to agent_logs if we have a service role key
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      try {
        await supabase.from("agent_logs").insert({
          user_id: payload.user?.id || "00000000-0000-0000-0000-000000000000",
          agent_name: "email_agent",
          log_level: "info",
          message: `Sent ${emailType} email to ${email}`,
          metadata: { email_type: emailType, recipient: email },
        });
      } catch (logError) {
        console.error("Failed to log:", logError);
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: `Email sent to ${email}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Email agent error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
