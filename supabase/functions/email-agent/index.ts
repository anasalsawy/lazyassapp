import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================================
// EMAIL TYPES - All possible email categories
// ============================================================================
type EmailType = 
  // Auth emails
  | "signup" | "magic_link" | "recovery" | "email_change" | "invite"
  // Application emails
  | "application_submitted" | "application_status_update" | "interview_scheduled"
  | "offer_received" | "rejection_received"
  // Job emails  
  | "new_job_matches" | "job_digest_daily" | "job_digest_weekly" | "saved_job_expiring"
  // Resume emails
  | "resume_analyzed" | "resume_score_improved" | "resume_optimization_complete"
  // Agent emails
  | "auto_apply_summary" | "agent_task_complete" | "agent_error_alert"
  // Communication emails
  | "recruiter_reply" | "follow_up_reminder" | "message_received"
  // System emails
  | "welcome" | "account_verified" | "subscription_update" | "system_notification";

interface EmailPayload {
  type: EmailType;
  to: string;
  data?: Record<string, unknown>;
  user_id?: string;
}

// ============================================================================
// MAILGUN SENDER
// ============================================================================
async function sendMailgunEmail(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string; id?: string }> {
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
  return { success: true, id: result.id };
}

// ============================================================================
// BASE EMAIL WRAPPER
// ============================================================================
function wrapEmail(content: string, previewText: string = ""): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LazyAss</title>
  <!--[if !mso]><!-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
  <!--<![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0b; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden;">${previewText}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="min-width: 100%; background-color: #0a0a0b;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <!-- Header -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <tr>
            <td style="padding-bottom: 24px; text-align: center;">
              <span style="font-size: 28px; font-weight: 700; color: #ffffff;">Lazy<span style="background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Ass</span></span>
            </td>
          </tr>
        </table>
        
        <!-- Main Content -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #18181b; border-radius: 16px; border: 1px solid #27272a;">
          <tr>
            <td style="padding: 40px;">
              ${content}
            </td>
          </tr>
        </table>
        
        <!-- Footer -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <tr>
            <td style="padding: 24px; text-align: center;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #71717a;">
                Powered by LazyAss - Your AI Job Search Assistant
              </p>
              <p style="margin: 0; font-size: 12px; color: #52525b;">
                <a href="https://lazyassapp.lovable.app" style="color: #6366f1; text-decoration: none;">Visit Dashboard</a>
                &nbsp;•&nbsp;
                <a href="https://lazyassapp.lovable.app/settings" style="color: #6366f1; text-decoration: none;">Email Preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================
const TEMPLATES: Record<EmailType, (data: Record<string, unknown>) => { subject: string; html: string }> = {
  // ========== AUTH EMAILS ==========
  signup: (data) => ({
    subject: "🚀 Confirm your email - LazyAss",
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">🚀</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Welcome to LazyAss!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Confirm your email to start automating your job search.</p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${data.confirm_url}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          Confirm Email Address
        </a>
      </div>
      <p style="margin: 0; font-size: 14px; color: #71717a; text-align: center;">
        If you didn't create an account with ${data.email}, you can safely ignore this email.
      </p>
    `, "Confirm your email to get started"),
  }),

  magic_link: (data) => ({
    subject: "🔐 Your login link - LazyAss",
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">🔐</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Login to LazyAss</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Click below to securely log in to your account.</p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${data.login_url}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          Log In Now
        </a>
      </div>
      <p style="margin: 0; font-size: 14px; color: #71717a; text-align: center;">
        This link expires in 1 hour. If you didn't request this, ignore this email.
      </p>
    `, "Click to log in securely"),
  }),

  recovery: (data) => ({
    subject: "🔑 Reset your password - LazyAss",
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #ef4444 0%, #f97316 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">🔑</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Reset Your Password</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">We received a request to reset your password.</p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${data.reset_url}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #ef4444 0%, #f97316 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          Reset Password
        </a>
      </div>
      <p style="margin: 0; font-size: 14px; color: #71717a; text-align: center;">
        This link expires in 1 hour. If you didn't request this, please ignore it.
      </p>
    `, "Reset your password"),
  }),

  email_change: (data) => ({
    subject: "✉️ Confirm your new email - LazyAss",
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">✉️</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Confirm Email Change</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Click below to confirm your new email address.</p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${data.confirm_url}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          Confirm New Email
        </a>
      </div>
    `, "Confirm your new email address"),
  }),

  invite: (data) => ({
    subject: "🎉 You're invited to LazyAss!",
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">🎉</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">You're Invited!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Someone invited you to join LazyAss - your AI job search assistant.</p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${data.invite_url}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          Accept Invitation
        </a>
      </div>
    `, "Join LazyAss today"),
  }),

  // ========== APPLICATION EMAILS ==========
  application_submitted: (data) => ({
    subject: `✅ Applied to ${data.job_title} at ${data.company}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">✅</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Application Submitted!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Your application has been successfully sent.</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <h3 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #ffffff;">${data.job_title}</h3>
        <p style="margin: 0 0 8px; font-size: 14px; color: #a1a1aa;">
          <span style="color: #6366f1;">🏢</span> ${data.company}
        </p>
        <p style="margin: 0 0 8px; font-size: 14px; color: #a1a1aa;">
          <span style="color: #6366f1;">📍</span> ${data.location || 'Remote'}
        </p>
        ${data.match_score ? `<p style="margin: 0; font-size: 14px; color: #10b981;">
          <span>🎯</span> ${data.match_score}% Match
        </p>` : ''}
      </div>
      
      ${data.cover_letter_generated ? `
      <div style="background: #1e1b4b; border: 1px solid #4338ca; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
        <p style="margin: 0; font-size: 14px; color: #a5b4fc;">
          📝 AI-generated cover letter was included with your application.
        </p>
      </div>` : ''}
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/applications" style="display: inline-block; padding: 12px 24px; background: #27272a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px; border: 1px solid #3f3f46;">
          View All Applications
        </a>
      </div>
    `, `Applied to ${data.job_title} at ${data.company}`),
  }),

  application_status_update: (data) => ({
    subject: `📋 Update: Your ${data.company} application`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #f59e0b 0%, #eab308 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">📋</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Application Update</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Your application status has changed.</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <h3 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #ffffff;">${data.job_title}</h3>
        <p style="margin: 0 0 16px; font-size: 14px; color: #a1a1aa;">at ${data.company}</p>
        
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 12px; color: #71717a; text-transform: uppercase;">${data.old_status}</span>
          <span style="color: #6366f1;">→</span>
          <span style="display: inline-block; padding: 6px 12px; background: ${data.new_status === 'interview' ? '#10b981' : data.new_status === 'offer' ? '#6366f1' : data.new_status === 'rejected' ? '#ef4444' : '#f59e0b'}; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 20px; text-transform: uppercase;">
            ${data.new_status}
          </span>
        </div>
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/applications" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
          View Application
        </a>
      </div>
    `, `Status update for ${data.company}`),
  }),

  interview_scheduled: (data) => ({
    subject: `🎉 Interview scheduled with ${data.company}!`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">🎉</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Interview Scheduled!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Great news! You have an interview coming up.</p>
      </div>
      
      <div style="background: linear-gradient(135deg, #064e3b 0%, #065f46 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #10b981;">
        <h3 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #ffffff;">${data.job_title}</h3>
        <p style="margin: 0 0 12px; font-size: 16px; color: #a7f3d0;">🏢 ${data.company}</p>
        <p style="margin: 0 0 12px; font-size: 16px; color: #a7f3d0;">📅 ${data.interview_date}</p>
        <p style="margin: 0 0 12px; font-size: 16px; color: #a7f3d0;">⏰ ${data.interview_time}</p>
        ${data.interview_type ? `<p style="margin: 0; font-size: 16px; color: #a7f3d0;">💻 ${data.interview_type}</p>` : ''}
      </div>
      
      ${data.meeting_link ? `
      <div style="text-align: center; margin: 32px 0;">
        <a href="${data.meeting_link}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          Join Meeting
        </a>
      </div>` : ''}
    `, `Interview with ${data.company} on ${data.interview_date}`),
  }),

  offer_received: (data) => ({
    subject: `🎊 Congratulations! Offer from ${data.company}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">🎊</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">You Got an Offer!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Congratulations on this amazing achievement!</p>
      </div>
      
      <div style="background: linear-gradient(135deg, #312e81 0%, #4338ca 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #6366f1;">
        <h3 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #ffffff;">${data.job_title}</h3>
        <p style="margin: 0 0 12px; font-size: 16px; color: #c7d2fe;">🏢 ${data.company}</p>
        ${data.salary ? `<p style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #a5b4fc;">💰 ${data.salary}</p>` : ''}
        ${data.start_date ? `<p style="margin: 0; font-size: 16px; color: #c7d2fe;">📅 Start Date: ${data.start_date}</p>` : ''}
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/applications" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          View Offer Details
        </a>
      </div>
    `, `Offer from ${data.company}!`),
  }),

  rejection_received: (data) => ({
    subject: `Update from ${data.company}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: #27272a; border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">📬</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Application Update</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">We have an update on your application.</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0; font-size: 16px; color: #d4d4d8; line-height: 1.6;">
          Unfortunately, ${data.company} has decided to move forward with other candidates for the ${data.job_title} position.
        </p>
      </div>
      
      <div style="background: #1e1b4b; border: 1px solid #4338ca; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #a5b4fc;">💪 Don't give up!</p>
        <p style="margin: 0; font-size: 14px; color: #c7d2fe;">
          Our AI agents are still working on finding your perfect match. Check your dashboard for new opportunities.
        </p>
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/jobs" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
          Browse New Jobs
        </a>
      </div>
    `, `Update from ${data.company}`),
  }),

  // ========== JOB EMAILS ==========
  new_job_matches: (data) => ({
    subject: `🎯 ${data.count} new job matches found!`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">🎯</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">New Job Matches!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Our AI found ${data.count} new opportunities for you.</p>
      </div>
      
      ${(data.jobs as Array<{ title: string; company: string; location: string; match_score: number }>)?.slice(0, 5).map((job) => `
      <div style="background: #27272a; border-radius: 12px; padding: 16px; margin: 12px 0; border-left: 4px solid #6366f1;">
        <h4 style="margin: 0 0 8px; font-size: 16px; font-weight: 600; color: #ffffff;">${job.title}</h4>
        <p style="margin: 0 0 4px; font-size: 14px; color: #a1a1aa;">🏢 ${job.company}</p>
        <p style="margin: 0; font-size: 14px; color: #a1a1aa;">📍 ${job.location} • 🎯 ${job.match_score}% match</p>
      </div>
      `).join('') || ''}
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/jobs" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          View All Matches
        </a>
      </div>
    `, `${data.count} new jobs match your profile`),
  }),

  job_digest_daily: (data) => ({
    subject: `📊 Your Daily Job Digest - ${data.date}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #f59e0b 0%, #eab308 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">📊</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Daily Digest</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">${data.date}</p>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0;">
        <div style="background: #27272a; border-radius: 8px; padding: 16px; text-align: center;">
          <p style="margin: 0 0 4px; font-size: 24px; font-weight: 700; color: #6366f1;">${data.new_jobs}</p>
          <p style="margin: 0; font-size: 12px; color: #71717a;">New Jobs</p>
        </div>
        <div style="background: #27272a; border-radius: 8px; padding: 16px; text-align: center;">
          <p style="margin: 0 0 4px; font-size: 24px; font-weight: 700; color: #10b981;">${data.applications_sent}</p>
          <p style="margin: 0; font-size: 12px; color: #71717a;">Applied</p>
        </div>
        <div style="background: #27272a; border-radius: 8px; padding: 16px; text-align: center;">
          <p style="margin: 0 0 4px; font-size: 24px; font-weight: 700; color: #f59e0b;">${data.responses}</p>
          <p style="margin: 0; font-size: 12px; color: #71717a;">Responses</p>
        </div>
      </div>
      
      ${data.top_matches ? `
      <h3 style="margin: 24px 0 12px; font-size: 16px; font-weight: 600; color: #ffffff;">Top Matches Today</h3>
      ${(data.top_matches as Array<{ title: string; company: string; match_score: number }>).slice(0, 3).map((job) => `
      <div style="background: #27272a; border-radius: 8px; padding: 12px; margin: 8px 0; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <p style="margin: 0 0 4px; font-size: 14px; font-weight: 500; color: #ffffff;">${job.title}</p>
          <p style="margin: 0; font-size: 12px; color: #71717a;">${job.company}</p>
        </div>
        <span style="padding: 4px 8px; background: #6366f1; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 4px;">${job.match_score}%</span>
      </div>
      `).join('')}` : ''}
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/dashboard" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
          Open Dashboard
        </a>
      </div>
    `, `Daily summary: ${data.new_jobs} jobs, ${data.applications_sent} applications`),
  }),

  job_digest_weekly: (data) => ({
    subject: `📈 Your Weekly Job Search Report`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">📈</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Weekly Report</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">${data.week_range}</p>
      </div>
      
      <div style="background: linear-gradient(135deg, #312e81 0%, #4338ca 100%); border-radius: 12px; padding: 24px; margin: 24px 0;">
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
          <div style="text-align: center;">
            <p style="margin: 0 0 4px; font-size: 32px; font-weight: 700; color: #ffffff;">${data.total_applications}</p>
            <p style="margin: 0; font-size: 14px; color: #c7d2fe;">Applications</p>
          </div>
          <div style="text-align: center;">
            <p style="margin: 0 0 4px; font-size: 32px; font-weight: 700; color: #ffffff;">${data.response_rate}%</p>
            <p style="margin: 0; font-size: 14px; color: #c7d2fe;">Response Rate</p>
          </div>
          <div style="text-align: center;">
            <p style="margin: 0 0 4px; font-size: 32px; font-weight: 700; color: #ffffff;">${data.interviews}</p>
            <p style="margin: 0; font-size: 14px; color: #c7d2fe;">Interviews</p>
          </div>
          <div style="text-align: center;">
            <p style="margin: 0 0 4px; font-size: 32px; font-weight: 700; color: #ffffff;">${data.new_matches}</p>
            <p style="margin: 0; font-size: 14px; color: #c7d2fe;">New Matches</p>
          </div>
        </div>
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/dashboard" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
          View Full Report
        </a>
      </div>
    `, `Weekly: ${data.total_applications} apps, ${data.response_rate}% response rate`),
  }),

  saved_job_expiring: (data) => ({
    subject: `⏰ Saved job expires soon: ${data.job_title}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">⏰</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Job Expires Soon!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">A saved job is about to close.</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid #f59e0b;">
        <h3 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #ffffff;">${data.job_title}</h3>
        <p style="margin: 0 0 8px; font-size: 14px; color: #a1a1aa;">🏢 ${data.company}</p>
        <p style="margin: 0; font-size: 14px; color: #fbbf24;">⏰ Expires: ${data.expires_at}</p>
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="${data.job_url}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #f59e0b 0%, #eab308 100%); color: #18181b; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          Apply Now
        </a>
      </div>
    `, `${data.job_title} at ${data.company} expires ${data.expires_at}`),
  }),

  // ========== RESUME EMAILS ==========
  resume_analyzed: (data) => ({
    subject: `📄 Resume Analysis Complete - Score: ${data.ats_score}%`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">📄</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Resume Analyzed!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Here's how your resume performed.</p>
      </div>
      
      <div style="background: linear-gradient(135deg, ${Number(data.ats_score) >= 80 ? '#10b981, #059669' : Number(data.ats_score) >= 60 ? '#f59e0b, #d97706' : '#ef4444, #dc2626'}); border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center;">
        <p style="margin: 0 0 8px; font-size: 48px; font-weight: 700; color: #ffffff;">${data.ats_score}%</p>
        <p style="margin: 0; font-size: 16px; color: rgba(255,255,255,0.8);">ATS Compatibility Score</p>
      </div>
      
      ${data.strengths ? `
      <h3 style="margin: 24px 0 12px; font-size: 16px; font-weight: 600; color: #10b981;">✅ Strengths</h3>
      <ul style="margin: 0; padding-left: 20px; color: #d4d4d8;">
        ${(data.strengths as string[]).map(s => `<li style="margin-bottom: 8px;">${s}</li>`).join('')}
      </ul>` : ''}
      
      ${data.improvements ? `
      <h3 style="margin: 24px 0 12px; font-size: 16px; font-weight: 600; color: #f59e0b;">💡 Improvements</h3>
      <ul style="margin: 0; padding-left: 20px; color: #d4d4d8;">
        ${(data.improvements as string[]).map(i => `<li style="margin-bottom: 8px;">${i}</li>`).join('')}
      </ul>` : ''}
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/resume" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
          View Full Analysis
        </a>
      </div>
    `, `ATS Score: ${data.ats_score}%`),
  }),

  resume_score_improved: (data) => ({
    subject: `🎉 Your resume score improved to ${data.new_score}%!`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">🎉</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Score Improved!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Your resume optimization is paying off.</p>
      </div>
      
      <div style="display: flex; align-items: center; justify-content: center; gap: 24px; margin: 24px 0;">
        <div style="text-align: center;">
          <p style="margin: 0; font-size: 32px; font-weight: 700; color: #71717a;">${data.old_score}%</p>
          <p style="margin: 0; font-size: 12px; color: #52525b;">Before</p>
        </div>
        <span style="font-size: 24px; color: #10b981;">→</span>
        <div style="text-align: center;">
          <p style="margin: 0; font-size: 32px; font-weight: 700; color: #10b981;">${data.new_score}%</p>
          <p style="margin: 0; font-size: 12px; color: #52525b;">After</p>
        </div>
      </div>
      
      <div style="background: #052e16; border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin: 24px 0; text-align: center;">
        <p style="margin: 0; font-size: 24px; font-weight: 700; color: #10b981;">+${Number(data.new_score) - Number(data.old_score)}%</p>
        <p style="margin: 0; font-size: 14px; color: #a7f3d0;">Improvement</p>
      </div>
    `, `Resume score: ${data.old_score}% → ${data.new_score}%`),
  }),

  resume_optimization_complete: (data) => ({
    subject: `✨ Resume optimization complete!`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">✨</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Optimization Complete!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Your AI-optimized resume is ready.</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0 0 16px; font-size: 14px; color: #d4d4d8;">Your resume has been optimized for:</p>
        ${(data.optimized_for as string[])?.map(item => `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="color: #10b981;">✓</span>
          <span style="color: #d4d4d8; font-size: 14px;">${item}</span>
        </div>
        `).join('') || ''}
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/resume" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          Download Resume
        </a>
      </div>
    `, "Your optimized resume is ready"),
  }),

  // ========== AGENT EMAILS ==========
  auto_apply_summary: (data) => ({
    subject: `🤖 Auto-Apply Summary: ${data.count} applications sent`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">🤖</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Auto-Apply Complete</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Your AI agent has been busy applying to jobs.</p>
      </div>
      
      <div style="background: linear-gradient(135deg, #312e81 0%, #4338ca 100%); border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center;">
        <p style="margin: 0 0 8px; font-size: 48px; font-weight: 700; color: #ffffff;">${data.count}</p>
        <p style="margin: 0; font-size: 16px; color: #c7d2fe;">Applications Submitted</p>
      </div>
      
      <h3 style="margin: 24px 0 12px; font-size: 16px; font-weight: 600; color: #ffffff;">Jobs Applied To:</h3>
      ${(data.applications as Array<{ title: string; company: string; match_score: number }>)?.map(app => `
      <div style="background: #27272a; border-radius: 8px; padding: 12px; margin: 8px 0;">
        <p style="margin: 0 0 4px; font-size: 14px; font-weight: 500; color: #ffffff;">${app.title}</p>
        <p style="margin: 0; font-size: 12px; color: #71717a;">${app.company} • ${app.match_score}% match</p>
      </div>
      `).join('') || ''}
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/applications" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
          View Applications
        </a>
      </div>
    `, `Auto-applied to ${data.count} jobs`),
  }),

  agent_task_complete: (data) => ({
    subject: `✅ Task Complete: ${data.task_name}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">✅</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Task Complete</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">${data.task_name}</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0 0 12px; font-size: 14px; color: #71717a;">Agent: <span style="color: #6366f1;">${data.agent_name}</span></p>
        <p style="margin: 0 0 12px; font-size: 14px; color: #71717a;">Duration: <span style="color: #ffffff;">${data.duration}</span></p>
        ${data.result_summary ? `<p style="margin: 0; font-size: 14px; color: #d4d4d8;">${data.result_summary}</p>` : ''}
      </div>
    `, `${data.agent_name} completed: ${data.task_name}`),
  }),

  agent_error_alert: (data) => ({
    subject: `⚠️ Agent Error: ${data.agent_name}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">⚠️</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Agent Error</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">An error occurred during automation.</p>
      </div>
      
      <div style="background: #450a0a; border: 1px solid #ef4444; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0 0 12px; font-size: 14px; color: #fca5a5;">Agent: ${data.agent_name}</p>
        <p style="margin: 0 0 12px; font-size: 14px; color: #fca5a5;">Task: ${data.task_type}</p>
        <p style="margin: 0; font-size: 14px; color: #fecaca; font-family: monospace; background: #27272a; padding: 12px; border-radius: 8px;">${data.error_message}</p>
      </div>
      
      <p style="margin: 0; font-size: 14px; color: #71717a; text-align: center;">
        The system will automatically retry. No action needed.
      </p>
    `, `Error in ${data.agent_name}: ${data.task_type}`),
  }),

  // ========== COMMUNICATION EMAILS ==========
  recruiter_reply: (data) => ({
    subject: `💬 Reply from ${data.recruiter_name || data.company}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">💬</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">New Message</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">A recruiter replied to your application.</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">From: <span style="color: #ffffff;">${data.recruiter_name || 'Recruiter'}</span></p>
        <p style="margin: 0 0 16px; font-size: 14px; color: #71717a;">Company: <span style="color: #6366f1;">${data.company}</span></p>
        <div style="border-top: 1px solid #3f3f46; padding-top: 16px;">
          <p style="margin: 0; font-size: 14px; color: #d4d4d8; line-height: 1.6;">${data.message_preview}</p>
        </div>
      </div>
      
      ${data.ai_sentiment ? `
      <div style="background: ${data.ai_sentiment === 'positive' ? '#052e16' : data.ai_sentiment === 'interview_request' ? '#1e1b4b' : '#27272a'}; border: 1px solid ${data.ai_sentiment === 'positive' ? '#10b981' : data.ai_sentiment === 'interview_request' ? '#6366f1' : '#3f3f46'}; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
        <p style="margin: 0; font-size: 14px; color: ${data.ai_sentiment === 'positive' ? '#a7f3d0' : data.ai_sentiment === 'interview_request' ? '#c7d2fe' : '#a1a1aa'};">
          🤖 AI Analysis: ${data.ai_sentiment === 'positive' ? 'Positive response!' : data.ai_sentiment === 'interview_request' ? '🎉 Interview invitation!' : data.ai_sentiment}
        </p>
      </div>` : ''}
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/messages" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          View & Reply
        </a>
      </div>
    `, `Message from ${data.company}`),
  }),

  follow_up_reminder: (data) => ({
    subject: `📅 Follow-up reminder: ${data.company}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #f59e0b 0%, #eab308 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">📅</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Time to Follow Up</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">It's been ${data.days_since_applied} days since you applied.</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <h3 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #ffffff;">${data.job_title}</h3>
        <p style="margin: 0 0 8px; font-size: 14px; color: #a1a1aa;">🏢 ${data.company}</p>
        <p style="margin: 0; font-size: 14px; color: #a1a1aa;">📅 Applied: ${data.applied_date}</p>
      </div>
      
      ${data.suggested_message ? `
      <div style="background: #1e1b4b; border: 1px solid #4338ca; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #a5b4fc;">💡 AI Suggested Follow-up:</p>
        <p style="margin: 0; font-size: 14px; color: #c7d2fe; font-style: italic;">"${data.suggested_message}"</p>
      </div>` : ''}
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/applications" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #f59e0b 0%, #eab308 100%); color: #18181b; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 8px;">
          Send Follow-up
        </a>
      </div>
    `, `Follow up on ${data.job_title} at ${data.company}`),
  }),

  message_received: (data) => ({
    subject: `📩 New message: ${data.subject}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">📩</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">New Message</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">You have a new message in your inbox.</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">From: <span style="color: #ffffff;">${data.from_name}</span></p>
        <p style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #ffffff;">${data.subject}</p>
        <div style="border-top: 1px solid #3f3f46; padding-top: 16px;">
          <p style="margin: 0; font-size: 14px; color: #d4d4d8; line-height: 1.6;">${data.preview}</p>
        </div>
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/messages" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
          Read Message
        </a>
      </div>
    `, `${data.from_name}: ${data.subject}`),
  }),

  // ========== SYSTEM EMAILS ==========
  welcome: (data) => ({
    subject: "🎉 Welcome to LazyAss - Let's automate your job search!",
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 20px; margin: 0 auto 16px; line-height: 80px; font-size: 40px;">🚀</div>
        <h1 style="margin: 0 0 8px; font-size: 28px; font-weight: 700; color: #ffffff;">Welcome to LazyAss!</h1>
        <p style="margin: 0; font-size: 18px; color: #a1a1aa;">Your AI-powered job search journey starts now.</p>
      </div>
      
      <div style="margin: 32px 0;">
        <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #ffffff;">Get started in 3 easy steps:</h3>
        
        <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 16px;">
          <div style="width: 32px; height: 32px; background: #6366f1; border-radius: 50%; line-height: 32px; text-align: center; color: #ffffff; font-weight: 600; flex-shrink: 0;">1</div>
          <div>
            <p style="margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #ffffff;">Upload your resume</p>
            <p style="margin: 0; font-size: 14px; color: #71717a;">Our AI will analyze and optimize it for ATS systems.</p>
          </div>
        </div>
        
        <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 16px;">
          <div style="width: 32px; height: 32px; background: #6366f1; border-radius: 50%; line-height: 32px; text-align: center; color: #ffffff; font-weight: 600; flex-shrink: 0;">2</div>
          <div>
            <p style="margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #ffffff;">Set your preferences</p>
            <p style="margin: 0; font-size: 14px; color: #71717a;">Tell us what roles and companies you're interested in.</p>
          </div>
        </div>
        
        <div style="display: flex; align-items: flex-start; gap: 16px;">
          <div style="width: 32px; height: 32px; background: #6366f1; border-radius: 50%; line-height: 32px; text-align: center; color: #ffffff; font-weight: 600; flex-shrink: 0;">3</div>
          <div>
            <p style="margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #ffffff;">Enable auto-apply</p>
            <p style="margin: 0; font-size: 14px; color: #71717a;">Sit back while our AI agents apply to matching jobs.</p>
          </div>
        </div>
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/dashboard" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 18px; font-weight: 600; border-radius: 8px;">
          Go to Dashboard
        </a>
      </div>
    `, "Let's automate your job search!"),
  }),

  account_verified: (data) => ({
    subject: "✅ Email verified - You're all set!",
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">✅</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Email Verified!</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Your account is now fully activated.</p>
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/dashboard" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
          Start Job Hunting
        </a>
      </div>
    `, "Your account is verified"),
  }),

  subscription_update: (data) => ({
    subject: `📦 Subscription ${data.action}: ${data.plan_name}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">📦</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">Subscription ${data.action}</h1>
        <p style="margin: 0; font-size: 16px; color: #a1a1aa;">Your subscription has been updated.</p>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">Current Plan</p>
        <p style="margin: 0; font-size: 24px; font-weight: 700; color: #6366f1;">${data.plan_name}</p>
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://lazyassapp.lovable.app/settings" style="display: inline-block; padding: 12px 24px; background: #27272a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px; border: 1px solid #3f3f46;">
          Manage Subscription
        </a>
      </div>
    `, `${data.plan_name} subscription ${data.action}`),
  }),

  system_notification: (data) => ({
    subject: `ℹ️ ${data.title}`,
    html: wrapEmail(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: #27272a; border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">ℹ️</div>
        <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #ffffff;">${data.title}</h1>
      </div>
      
      <div style="background: #27272a; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0; font-size: 16px; color: #d4d4d8; line-height: 1.6;">${data.message}</p>
      </div>
      
      ${data.action_url ? `
      <div style="text-align: center; margin: 32px 0;">
        <a href="${data.action_url}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
          ${data.action_text || 'Learn More'}
        </a>
      </div>` : ''}
    `, data.title as string),
  }),
};

// ============================================================================
// MAIN HANDLER
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: EmailPayload = await req.json();
    console.log("Email agent received:", JSON.stringify(payload, null, 2));

    const { type, to, data = {}, user_id } = payload;

    if (!to) {
      throw new Error("No recipient email provided");
    }

    if (!type || !TEMPLATES[type]) {
      throw new Error(`Unknown email type: ${type}`);
    }

    // Generate email content
    const template = TEMPLATES[type];
    const { subject, html } = template({ ...data, email: to });

    // Send via Mailgun
    const result = await sendMailgunEmail(to, subject, html);

    if (!result.success) {
      throw new Error(result.error || "Failed to send email");
    }

    // Log the email
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseServiceKey && user_id) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      try {
        await supabase.from("agent_logs").insert({
          user_id,
          agent_name: "email_agent",
          log_level: "info",
          message: `Sent ${type} email to ${to}`,
          metadata: { email_type: type, recipient: to, mailgun_id: result.id },
        });
      } catch (logError) {
        console.error("Failed to log:", logError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Email sent to ${to}`,
        type,
        id: result.id 
      }),
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
