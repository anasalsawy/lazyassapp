# Career Compass - Complete Platform Specification

## 1. Product Overview

A fully-automated job search & application platform where:
- User uploads resume once and logs into email + job sites
- System optimizes/redesigns resume
- Uses BrowserUse to control real browser sessions with saved logins
- Continuously searches for jobs, applies automatically, monitors email

**User Experience Goal:**
> "I upload my CV, log in once to my accounts, and then the agent just keeps hunting and applying for jobs for me in the background."

---

## 2. Core Workflow (End-to-End)

### Step 1 – User Onboarding
1. User creates account
2. Fills minimal profile: name, location, target roles, salary range, preferred locations
3. Uploads existing resume (PDF/DOCX/text)

### Step 2 – Resume Agent
1. Takes uploaded resume and:
   - Rewrites/optimizes (keywords, ATS-friendly wording, impact verbs)
   - Cleans structure, fixes grammar
   - Generates polished resume version
2. Optionally generates:
   - Multiple versions for different job types
   - Default cover letter template
3. Final resume(s) saved in user's profile for BrowserUse to use

### Step 3 – Authorization Session (BrowserUse)
**Critical Step:**
1. Start BrowserUse authorization session for user
2. User sees real browser window controlled by BrowserUse
3. User logs into:
   - Primary email account (Gmail/Outlook)
   - Job platforms: Indeed, LinkedIn, others
4. BrowserUse saves session/profile data (cookies, login state, tokens)
5. When user confirms "Done":
   - Associate BrowserUse profile/session ID with user in database
   - All future automation uses this saved profile

**After this step, user's job is basically finished. Everything else is automated.**

### Step 4 – Automated Job Search
1. Job Search Agent runs in backend
2. For each user, BrowserUse session loads saved profile:
   - Opens job platforms
   - Searches based on user preferences (keywords, location, salary)
3. Agent:
   - Scrapes matching job listings
   - Evaluates relevance
   - Saves shortlisted jobs to user's account

### Step 5 – Automated Application
1. Application Agent uses same BrowserUse session to:
   - Open job page
   - Click "Apply"
   - Fill forms using profile data + optimized resume
   - Generate answers to standard questions via LLM
   - Upload resume file
   - Submit application
2. Each application logged with status: Applied / Error / Needs user input

### Step 6 – Email Monitoring & Follow-Up
1. Email Agent periodically opens inbox via BrowserUse
2. Looks for job-related emails (interviews, rejections)
3. Detected events:
   - Parsed and added to Application Timeline
   - Can trigger follow-up actions (draft replies, approval requests)

---

## 3. System Components / Agents

### 3.1 User Profile Service
- Stores user info, preferences, BrowserUse profile/session IDs
- Stores references to optimized resumes

### 3.2 Resume Agent
- Input: raw resume + user info
- Output: optimized resume(s) (text + PDF)
- Uses LLM for rewriting and keyword optimization

### 3.3 BrowserUse Session Manager
- Creates authorization sessions for new users
- Links BrowserUse profile ID to user
- Starts sessions using saved profile ID for automation

### 3.4 Job Search Agent
- Runs inside BrowserUse session
- Opens job platforms, runs filters
- Scrapes relevant job posts
- Returns structured data: title, company, location, link

### 3.5 Application Agent
- Takes job listing + user profile + resume
- Controls BrowserUse to navigate, click Apply, fill forms, upload resume
- Returns status and errors

### 3.6 Email / Follow-Up Agent
- Uses BrowserUse to access user's email inbox
- Searches for application-related messages
- Updates user's timeline/status

### 3.7 Scheduler / Orchestrator
- Launches: job search runs, application runs, email checks
- Manages rate limits, avoids over-applying

---

## 4. Website Structure

### 4.1 Landing Page
- **Hero section:** "Upload your resume once. Let the agent search and apply for jobs for you."
- **Workflow explanation:**
  1. Upload resume
  2. Log into email & job sites once
  3. Agent searches, applies, tracks responses
- **CTA:** Get Started / Sign Up
- **Trust/FAQ section:** privacy, security, login session usage

### 4.2 Sign Up / Onboarding Flow
- **Page 1:** Account creation (email + password or OAuth)
- **Page 2:** Basic profile (name, location, target roles, salary, remote preference)
- **Page 3:** Resume upload with preview
- **Page 4:** Resume optimization (show agent working, before/after preview)

### 4.3 Connections & Authorization Page
- Clear instructions for BrowserUse authorization
- Button: "Start Authorization Session"
- After login completion: ✅ "Authorization complete. Your agent is ready."

### 4.4 Dashboard
**Sections:**
1. **Status Summary**
   - Jobs applied today/this week
   - Applications in progress
   - Responses received

2. **Applications Timeline**
   - Job title, company, platform
   - Status: Applied, In Review, Interview, Rejected
   - Link to job page

3. **Upcoming Actions**
   - Items needing user input

4. **Controls**
   - Toggle: Auto-apply On/Off
   - Filters: roles, locations

### 4.5 Resume & Settings
**Resume page:**
- View optimized resume(s)
- Regenerate/update option
- Download as PDF

**Settings page:**
- Edit job preferences
- Manage connections (show auth status, re-authorize button)

---

## 5. Application Data Model

```typescript
interface Application {
  id: string;                    // internal ID
  user_id: string;               // which user
  platform: 'indeed' | 'linkedin' | 'other';
  job_url: string;               // direct link to job posting
  job_title: string;             // scraped at apply time
  company_name: string;          // scraped at apply time
  location?: string;             // scraped
  applied_at: timestamp;
  last_checked_at: timestamp;
  status: ApplicationStatus;
  status_source: 'platform' | 'email' | 'system';
  status_message: string;        // human-readable explanation
  email_thread_id?: string;      // for follow-ups
  extra_metadata?: JSON;         // job_id, salary, tags
}

type ApplicationStatus = 
  | 'pending-apply'      // queued but not yet applied
  | 'applying'           // in progress
  | 'applied'            // submitted, no feedback yet
  | 'in-review'          // platform shows "Under consideration"
  | 'interview'          // interview invite detected
  | 'offer'              // offer email detected
  | 'rejected'           // rejection email or status
  | 'error'              // something went wrong
  | 'needs-user-action'; // manual question, captcha, etc.
```

---

## 6. Tracking Mechanism with BrowserUse

### 6.1 When Application is Submitted
1. Application Agent applies to job via BrowserUse
2. After submit, check for confirmation text
3. Create Application record with status = "applied"
4. Link to tracking strategy (platform dashboard, job URL, or email)

### 6.2 Periodic Tracking Job
For each user on schedule:
1. Start BrowserUse session with saved profile
2. Visit each platform's "My Jobs" / "Applications"
3. Parse status for each application
4. Match to our records, update statuses
5. Check email for job-related messages

**Platform Status Mapping:**
- "Submitted" → "applied"
- "Under Review" → "in-review"
- "Interview Scheduled" → "interview"
- "Offer Extended" → "offer"
- "Not selected" → "rejected"

**Email Tracking:**
- Search inbox for job-related terms
- Detect: interview invites, offers, rejections
- Match to applications, update status

---

## 7. Dashboard UI Specification

### 7.1 Application List Row
Each row shows:
- Job title (clickable)
- Company name
- Platform icon
- Applied on date
- **Status badge** (color-coded)
- **Primary action button** (context-dependent)
- More menu (3 dots)

### 7.2 Status Badges
| Status | Color | Label |
|--------|-------|-------|
| pending-apply | gray | "Pending" |
| applying | blue + spinner | "Applying…" |
| applied | blue | "Applied" |
| in-review | purple | "In review" |
| interview | green | "Interview" |
| offer | gold | "Offer" |
| rejected | red | "Rejected" |
| needs-user-action | orange | "Action needed" |
| error | red | "Error" |

### 7.3 Primary Button Actions
| Status | Button Label | Action |
|--------|--------------|--------|
| pending-apply | "Apply now" | Queue immediate BrowserUse apply |
| applying | "Applying…" | Disabled, spinner |
| applied/in-review | "Check status" | Trigger status check |
| interview | "View details" | Open drawer with email/date |
| offer | "View offer" | Open drawer with offer text |
| rejected | "View reason" | Show email snippet |
| needs-user-action | "Resolve" | Open drawer with question + suggested answer |
| error | "Retry" | Re-queue application |

### 7.4 Secondary Actions (3-dot menu)
- Open job page
- Open platform dashboard
- View logs
- Archive

---

## 8. Status Update Mechanism

### 8.1 When Agent is Working
1. Immediately update UI (status = "applying" or "checking…")
2. Backend enqueues BrowserUse task
3. When task finishes, backend updates Application record
4. Frontend polls every 10-15 seconds OR receives WebSocket events

### 8.2 Global Refresh
- Header shows "Last checked: X minutes ago"
- "Refresh all statuses" button triggers full tracking run

---

## 9. Edge Cases

### 9.1 No Status Found
- Keep status = "applied"
- Update message = "No status label found; job still visible"

### 9.2 Job Disappeared
- status_message = "Job not found on platform dashboard anymore"

### 9.3 Login Expired
- Mark reauthorization required
- Show banner: "Please re-connect your accounts"
- Warning icon on affected platform rows

### 9.4 Bulk Actions
- Checkbox per row + global checkbox
- "Check status for selected"
- "Archive selected"

---

## 10. Implementation Notes

1. **After each BrowserUse action, agent must update application record via API**
2. **Dashboard UI reads statuses from DB only - no guessing/inferring**
3. **Status changes originate in tracking logic only**
4. **Security:** Never store raw credentials, rely on BrowserUse session management
5. **Scalability:** Design for parallel BrowserUse sessions, add rate limiting
6. **Extensibility:** Support more platforms, smarter Email Agent later
