import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Email classification types
type EmailClassification = 
  | "application_confirmation"
  | "interview_request"
  | "rejection"
  | "assessment"
  | "verification"
  | "mfa_code"
  | "other_job_related"
  | "not_job_related";

interface ExtractedData {
  company_name?: string;
  role_title?: string;
  job_url?: string;
  action_links?: string[];
  deadline?: string;
  mfa_code?: string;
  interview_date?: string;
  interview_type?: string;
}

interface EmailMessage {
  id: string;
  threadId?: string;
  from: string;
  fromName?: string;
  subject: string;
  snippet: string;
  body?: string;
  receivedAt: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const action = pathParts[pathParts.length - 1];

    // Validate JWT for user-facing endpoints
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

    // Route: POST /email-processor/sync - Sync emails for a user
    if (req.method === "POST" && action === "sync") {
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { connectionId } = await req.json();

      // Get connection
      const { data: connection, error: connError } = await supabaseAdmin
        .from("email_connections")
        .select("*")
        .eq("user_id", userId)
        .eq("id", connectionId)
        .single();

      if (connError || !connection) {
        return new Response(JSON.stringify({ error: "Connection not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (connection.status !== "connected") {
        return new Response(JSON.stringify({ error: "Connection not active" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch emails based on provider
      let emails: EmailMessage[] = [];
      const accessToken = connection.access_token_enc;

      if (connection.provider === "gmail") {
        emails = await fetchGmailMessages(accessToken, connection.email_cursor);
      } else if (connection.provider === "outlook") {
        emails = await fetchOutlookMessages(accessToken, connection.email_cursor);
      }

      console.log(`Fetched ${emails.length} emails from ${connection.provider}`);

      // Process each email
      let processed = 0;
      let newCursor = connection.email_cursor;

      for (const email of emails) {
        // Check if already processed
        const { data: existing } = await supabaseAdmin
          .from("job_emails")
          .select("id")
          .eq("user_id", userId)
          .eq("message_id", email.id)
          .single();

        if (existing) continue;

        // Classify and extract
        const { classification, confidence, extracted } = await classifyAndExtract(
          email,
          LOVABLE_API_KEY
        );

        // Skip non-job emails
        if (classification === "not_job_related") {
          console.log(`Skipping non-job email: ${email.subject}`);
          continue;
        }

        // Find matching application
        let linkedApplicationId = null;
        if (extracted.job_url || (extracted.company_name && extracted.role_title)) {
          const { data: apps } = await supabaseAdmin
            .from("applications")
            .select("id, jobs!inner(company, title, url)")
            .eq("user_id", userId);

          if (apps) {
            for (const app of apps as any[]) {
              if (extracted.job_url && app.jobs?.url === extracted.job_url) {
                linkedApplicationId = app.id;
                break;
              }
              if (
                extracted.company_name &&
                extracted.role_title &&
                app.jobs?.company?.toLowerCase().includes(extracted.company_name.toLowerCase()) &&
                app.jobs?.title?.toLowerCase().includes(extracted.role_title.toLowerCase())
              ) {
                linkedApplicationId = app.id;
                break;
              }
            }
          }
        }

        // Insert job email
        const { error: insertError } = await supabaseAdmin.from("job_emails").insert({
          user_id: userId,
          connection_id: connectionId,
          provider: connection.provider,
          message_id: email.id,
          thread_id: email.threadId,
          from_email: email.from,
          from_name: email.fromName,
          subject: email.subject,
          snippet: email.snippet,
          received_at: email.receivedAt,
          classification,
          confidence,
          extracted_json: extracted,
          linked_application_id: linkedApplicationId,
        });

        if (!insertError) {
          processed++;

          // Update application status if linked
          if (linkedApplicationId) {
            await updateApplicationFromEmail(
              supabaseAdmin,
              linkedApplicationId,
              classification,
              extracted
            );
          }

          // Create draft reply if needed
          const { data: settings } = await supabaseAdmin
            .from("email_agent_settings")
            .select("auto_create_drafts")
            .eq("user_id", userId)
            .single();

          if (settings?.auto_create_drafts && classification === "interview_request") {
            await createDraftReply(
              supabaseAdmin,
              userId,
              connectionId,
              email,
              classification,
              extracted,
              LOVABLE_API_KEY
            );
          }
        }

        // Update cursor
        if (!newCursor || email.receivedAt > newCursor) {
          newCursor = email.receivedAt;
        }
      }

      // Update connection sync time and cursor
      await supabaseAdmin
        .from("email_connections")
        .update({
          last_sync_at: new Date().toISOString(),
          email_cursor: newCursor,
        })
        .eq("id", connectionId);

      return new Response(
        JSON.stringify({ success: true, processed, total: emails.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: GET /email-processor/inbox - Get job inbox
    if (req.method === "GET" && action === "inbox") {
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const classification = url.searchParams.get("classification");
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");

      let query = supabaseAdmin
        .from("job_emails")
        .select(`
          *,
          applications:linked_application_id (
            id, status,
            jobs (title, company)
          )
        `)
        .eq("user_id", userId)
        .neq("classification", "not_job_related")
        .order("received_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (classification && classification !== "all") {
        query = query.eq("classification", classification);
      }

      const { data: emails, error: fetchError } = await query;

      if (fetchError) {
        return new Response(JSON.stringify({ error: "Failed to fetch emails" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get counts by classification
      const { data: counts } = await supabaseAdmin
        .from("job_emails")
        .select("classification")
        .eq("user_id", userId)
        .neq("classification", "not_job_related");

      const classificationCounts: Record<string, number> = {};
      counts?.forEach((e) => {
        classificationCounts[e.classification] = (classificationCounts[e.classification] || 0) + 1;
      });

      return new Response(
        JSON.stringify({ emails: emails || [], counts: classificationCounts }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: GET /email-processor/drafts - Get email drafts
    if (req.method === "GET" && action === "drafts") {
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: drafts, error: fetchError } = await supabaseAdmin
        .from("email_drafts")
        .select(`
          *,
          job_emails:job_email_id (subject, from_email, from_name, classification)
        `)
        .eq("user_id", userId)
        .eq("status", "draft")
        .order("created_at", { ascending: false });

      if (fetchError) {
        return new Response(JSON.stringify({ error: "Failed to fetch drafts" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ drafts: drafts || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: POST /email-processor/drafts/:id/send - Send a draft
    if (req.method === "POST" && (action === "send" || pathParts.includes("send"))) {
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { draftId, body } = await req.json();

      // Get draft
      const { data: draft, error: draftError } = await supabaseAdmin
        .from("email_drafts")
        .select("*, email_connections:connection_id (*)")
        .eq("id", draftId)
        .eq("user_id", userId)
        .single();

      if (draftError || !draft) {
        return new Response(JSON.stringify({ error: "Draft not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if sending is allowed
      const { data: settings } = await supabaseAdmin
        .from("email_agent_settings")
        .select("allow_sending")
        .eq("user_id", userId)
        .single();

      if (!settings?.allow_sending) {
        return new Response(
          JSON.stringify({ error: "Email sending is not enabled. Please enable it in settings." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Send email via provider
      const connection = draft.email_connections as any;
      const finalBody = body || draft.body;
      let sendResult = { success: false, error: "" };

      if (connection.provider === "gmail") {
        sendResult = await sendGmailMessage(
          connection.access_token_enc,
          draft.to_email,
          draft.subject,
          finalBody,
          draft.thread_id
        );
      } else if (connection.provider === "outlook") {
        sendResult = await sendOutlookMessage(
          connection.access_token_enc,
          draft.to_email,
          draft.subject,
          finalBody,
          draft.thread_id
        );
      }

      if (!sendResult.success) {
        await supabaseAdmin
          .from("email_drafts")
          .update({ status: "failed", metadata_json: { error: sendResult.error } })
          .eq("id", draftId);

        return new Response(
          JSON.stringify({ error: sendResult.error }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update draft status
      await supabaseAdmin
        .from("email_drafts")
        .update({ status: "sent", sent_at: new Date().toISOString(), body: finalBody })
        .eq("id", draftId);

      // Log event
      if (draft.job_email_id) {
        const { data: jobEmail } = await supabaseAdmin
          .from("job_emails")
          .select("linked_application_id")
          .eq("id", draft.job_email_id)
          .single();

        if (jobEmail?.linked_application_id) {
          await supabaseAdmin.from("application_events").insert({
            application_id: jobEmail.linked_application_id,
            event_type: "email_sent",
            payload_json: { draft_id: draftId, to: draft.to_email, subject: draft.subject },
          });
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: POST /email-processor/drafts/update - Update a draft
    if (req.method === "POST" && action === "update") {
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { draftId, subject, body } = await req.json();

      const { error: updateError } = await supabaseAdmin
        .from("email_drafts")
        .update({ subject, body })
        .eq("id", draftId)
        .eq("user_id", userId);

      if (updateError) {
        return new Response(JSON.stringify({ error: "Failed to update draft" }), {
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
    console.error("Email processor error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper: Fetch Gmail messages
async function fetchGmailMessages(accessToken: string, cursor?: string): Promise<EmailMessage[]> {
  const messages: EmailMessage[] = [];
  
  try {
    // Search for job-related emails
    const query = "category:primary (job OR interview OR application OR offer OR hiring OR recruiter OR career)";
    const params = new URLSearchParams({
      q: query,
      maxResults: "50",
    });

    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listResponse.ok) {
      console.error("Gmail list failed:", await listResponse.text());
      return [];
    }

    const listData = await listResponse.json();
    const messageIds = listData.messages || [];

    for (const msg of messageIds.slice(0, 20)) {
      const msgResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!msgResponse.ok) continue;

      const msgData = await msgResponse.json();
      const headers = msgData.payload?.headers || [];
      
      const fromHeader = headers.find((h: any) => h.name === "From")?.value || "";
      const subjectHeader = headers.find((h: any) => h.name === "Subject")?.value || "(no subject)";
      const dateHeader = headers.find((h: any) => h.name === "Date")?.value;

      // Parse from
      const fromMatch = fromHeader.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);
      const fromName = fromMatch?.[1] || "";
      const fromEmail = fromMatch?.[2] || fromHeader;

      messages.push({
        id: msgData.id,
        threadId: msgData.threadId,
        from: fromEmail,
        fromName,
        subject: subjectHeader,
        snippet: msgData.snippet || "",
        receivedAt: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Gmail fetch error:", error);
  }

  return messages;
}

// Helper: Fetch Outlook messages
async function fetchOutlookMessages(accessToken: string, cursor?: string): Promise<EmailMessage[]> {
  const messages: EmailMessage[] = [];

  try {
    const filter = "receivedDateTime ge " + new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      $filter: filter,
      $top: "50",
      $orderby: "receivedDateTime desc",
      $select: "id,conversationId,from,subject,bodyPreview,receivedDateTime",
    });

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      console.error("Outlook fetch failed:", await response.text());
      return [];
    }

    const data = await response.json();

    for (const msg of data.value || []) {
      messages.push({
        id: msg.id,
        threadId: msg.conversationId,
        from: msg.from?.emailAddress?.address || "",
        fromName: msg.from?.emailAddress?.name || "",
        subject: msg.subject || "(no subject)",
        snippet: msg.bodyPreview || "",
        receivedAt: msg.receivedDateTime,
      });
    }
  } catch (error) {
    console.error("Outlook fetch error:", error);
  }

  return messages;
}

// Helper: Classify and extract email data
async function classifyAndExtract(
  email: EmailMessage,
  apiKey?: string
): Promise<{ classification: EmailClassification; confidence: number; extracted: ExtractedData }> {
  const defaultResult = {
    classification: "other_job_related" as EmailClassification,
    confidence: 0.5,
    extracted: {} as ExtractedData,
  };

  if (!apiKey) return defaultResult;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are an email classifier for job search applications. Analyze the email and return JSON:
{
  "classification": "application_confirmation" | "interview_request" | "rejection" | "assessment" | "verification" | "mfa_code" | "other_job_related" | "not_job_related",
  "confidence": 0.0-1.0,
  "extracted": {
    "company_name": string or null,
    "role_title": string or null,
    "job_url": string or null,
    "action_links": string[] or null,
    "deadline": ISO date string or null,
    "mfa_code": string or null (if this is an MFA/verification code email),
    "interview_date": ISO date string or null,
    "interview_type": "phone" | "video" | "onsite" | null
  }
}

Classification guide:
- application_confirmation: Thank you for applying, we received your application
- interview_request: Invitation to interview, scheduling request
- rejection: We regret to inform, not moving forward
- assessment: Take-home test, coding challenge, assessment link
- verification: Verify your email, confirm your account
- mfa_code: One-time code, verification code, 2FA
- other_job_related: Other job-related but not above categories
- not_job_related: Not about jobs/careers at all

ONLY return valid JSON, no markdown.`,
          },
          {
            role: "user",
            content: `From: ${email.fromName} <${email.from}>
Subject: ${email.subject}
Preview: ${email.snippet}`,
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error("AI classification failed:", await response.text());
      return defaultResult;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) return defaultResult;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return defaultResult;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      classification: parsed.classification || "other_job_related",
      confidence: parsed.confidence || 0.5,
      extracted: parsed.extracted || {},
    };
  } catch (error) {
    console.error("Classification error:", error);
    return defaultResult;
  }
}

// Helper: Update application status from email
async function updateApplicationFromEmail(
  supabase: any,
  applicationId: string,
  classification: EmailClassification,
  extracted: ExtractedData
) {
  const statusMap: Record<string, string> = {
    application_confirmation: "applied",
    interview_request: "interview",
    rejection: "rejected",
    assessment: "in_review",
  };

  const newStatus = statusMap[classification];
  if (!newStatus) return;

  // Get current status
  const { data: app } = await supabase
    .from("applications")
    .select("status")
    .eq("id", applicationId)
    .single();

  if (!app) return;

  // Only update if meaningful progression
  const statusOrder = ["applied", "in_review", "interview", "offer", "rejected"];
  const currentIndex = statusOrder.indexOf(app.status);
  const newIndex = statusOrder.indexOf(newStatus);

  if (newIndex <= currentIndex && newStatus !== "rejected") return;

  await supabase
    .from("applications")
    .update({ status: newStatus })
    .eq("id", applicationId);

  await supabase.from("application_events").insert({
    application_id: applicationId,
    event_type: "email_received",
    payload_json: { classification, extracted },
  });
}

// Helper: Create draft reply
async function createDraftReply(
  supabase: any,
  userId: string,
  connectionId: string,
  email: EmailMessage,
  classification: EmailClassification,
  extracted: ExtractedData,
  apiKey?: string
) {
  if (!apiKey) return;

  try {
    // Get user profile for personalization
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("user_id", userId)
      .single();

    const userName = profile?.first_name || "there";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Generate a professional email reply. User's name: ${userName}. Keep it concise and friendly.
Return ONLY the email body text, no subject line, no JSON.`,
          },
          {
            role: "user",
            content: `Original email:
From: ${email.fromName} <${email.from}>
Subject: ${email.subject}
Content: ${email.snippet}

Classification: ${classification}
${extracted.interview_date ? `Interview date mentioned: ${extracted.interview_date}` : ""}
${extracted.interview_type ? `Interview type: ${extracted.interview_type}` : ""}

Generate an appropriate reply.`,
          },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) return;

    const data = await response.json();
    const body = data.choices?.[0]?.message?.content;

    if (!body) return;

    // Get the job email ID
    const { data: jobEmail } = await supabase
      .from("job_emails")
      .select("id")
      .eq("message_id", email.id)
      .single();

    await supabase.from("email_drafts").insert({
      user_id: userId,
      connection_id: connectionId,
      job_email_id: jobEmail?.id,
      provider: "gmail", // Will be set properly
      thread_id: email.threadId,
      to_email: email.from,
      subject: `Re: ${email.subject}`,
      body,
      status: "draft",
    });
  } catch (error) {
    console.error("Draft creation error:", error);
  }
}

// Helper: Send Gmail message
async function sendGmailMessage(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string
): Promise<{ success: boolean; error: string }> {
  try {
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n");

    const encodedMessage = btoa(message)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const payload: any = { raw: encodedMessage };
    if (threadId) payload.threadId = threadId;

    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true, error: "" };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Helper: Send Outlook message
async function sendOutlookMessage(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  conversationId?: string
): Promise<{ success: boolean; error: string }> {
  try {
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me/sendMail",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject,
            body: {
              contentType: "Text",
              content: body,
            },
            toRecipients: [
              {
                emailAddress: { address: to },
              },
            ],
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true, error: "" };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
