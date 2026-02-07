# Resume Optimization System - Complete Code Reference

> Generated: 2026-02-07
> This file contains all code related to the Resume Optimization multi-agent pipeline.

---

## Table of Contents
1. [Edge Function: optimize-resume](#1-edge-function)
2. [Hook: useResumeOptimizer](#2-hook)
3. [Component: OptimizationProgress](#3-progress-component)
4. [Component: OptimizeDialog](#4-dialog-component)
5. [Component: OptimizationResultView](#5-result-component)
6. [Page: Resume](#6-resume-page)
7. [Database: pipeline_continuations](#7-database)

---

## 1. Edge Function
**File:** `supabase/functions/optimize-resume/index.ts`

### Architecture
- **5 Agents:** Researcher → Writer ↔ Critic (adversarial loop) → Designer
- **Gatekeeper:** Strict process auditor at every step transition (no forced passes)
- **Manual Mode:** Pauses after each major step, saves state to `pipeline_continuations` table
- **Content Drift Prevention:** Designer output is verified against approved content
- **Audit Trail:** All steps logged to `agent_execution_logs` table

### Key Features
- `manual_mode` flag enables step-by-step execution with user approval
- `continuation_id` resumes pipeline from saved state
- `runGateWithRetry()` blocks pipeline on failure (max 2 retries, then halt)
- Schema validation for all AI outputs (Researcher, Critic, Gatekeeper)
- SSE streaming for real-time progress updates

### Event Types Emitted
| Event | Description |
|-------|-------------|
| `progress` | Step started/in-progress |
| `researcher_done` | Research checklist complete |
| `writer_done` | Draft version complete |
| `critic_done` | Scorecard produced |
| `designer_done` | HTML layout created |
| `gatekeeper_pass` | Step verified, proceeding |
| `gatekeeper_fail` | Step failed audit, retrying |
| `gatekeeper_blocked` | Step blocked after max retries |
| `await_user_continue` | Manual mode pause (includes `continuation_id`) |
| `complete` | Pipeline finished successfully |
| `error` | Pipeline error |

---

## 2. Hook
**File:** `src/hooks/useResumeOptimizer.ts`

### Exports
- `useResumeOptimizer()` - Main hook
- `Scorecard` interface
- `OptimizationResult` interface
- `GatekeeperVerdict` interface
- `OptimizationProgress` interface
- `ManualPause` interface

### Status Flow
```
idle → running → complete
                → error
                → awaiting_continue → running → complete/error/awaiting_continue
```

### Methods
| Method | Description |
|--------|-------------|
| `optimize(resumeId, targetRole, location?, manualMode?)` | Start optimization |
| `continueOptimization()` | Resume from manual pause |
| `cancel()` | Abort running optimization |
| `reset()` | Reset all state to idle |

---

## 3. Progress Component
**File:** `src/components/resume/OptimizationProgress.tsx`

### Props
| Prop | Type | Description |
|------|------|-------------|
| `progress` | `ProgressEvent[]` | All progress events |
| `currentStep` | `string` | Current pipeline step |
| `currentRound` | `number` | Writer/Critic round |
| `latestScorecard` | `Scorecard \| null` | Latest critic scores |
| `gatekeeperVerdicts` | `GatekeeperVerdict[]` | All gate verdicts |
| `manualPause` | `ManualPause \| null` | Current pause info |
| `onCancel` | `() => void` | Cancel handler |
| `onContinue` | `() => void` | Continue handler |

### Features
- Visual pipeline step tracker (researcher → writer → critic → designer)
- Gatekeeper sub-rows showing pass/fail per step
- Manual mode pause banner with continue button
- Live score preview (ATS, Keywords, Clarity)
- Audit trail showing last 5 gate verdicts

---

## 4. Dialog Component
**File:** `src/components/resume/OptimizeDialog.tsx`

### Features
- Target role input (required)
- Location input (optional)
- Manual Mode toggle switch
- Passes `manualMode` boolean to `onStart` callback

---

## 5. Result Component
**File:** `src/components/resume/OptimizationResultView.tsx`

### Features
- Score summary card (Overall, ATS, Keywords, Clarity)
- Praise and truth violation display
- Tabbed content view: Preview (HTML iframe), ATS Text, Changes
- Download buttons for text and HTML

---

## 6. Resume Page
**File:** `src/pages/Resume.tsx`

### Features
- Resume list with upload, delete, set primary
- Optimize button opens OptimizeDialog
- Shows OptimizationProgress during running/paused states
- Shows OptimizationResultView on completion
- Wires `continueOptimization` for manual mode

---

## 7. Database
**Table:** `pipeline_continuations`

```sql
CREATE TABLE public.pipeline_continuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  resume_id UUID NOT NULL,
  step_name TEXT NOT NULL,
  next_step TEXT NOT NULL,
  pipeline_state JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'awaiting_continue',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '1 hour')
);
-- RLS: Users can CRUD own continuations
-- Index on (user_id, resume_id, status)
-- Trigger: handle_updated_at on UPDATE
```

### Pipeline State Shape
```json
{
  "rawResumeText": "string",
  "role": "string",
  "loc": "string",
  "checklist": {},
  "draft": "string",
  "scorecard": {},
  "atsText": "string",
  "prettyMd": "string",
  "changelog": "string",
  "roundsCompleted": 0,
  "criticFeedback": "string"
}
```
