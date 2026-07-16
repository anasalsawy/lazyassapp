# Ops Room Rebuild Blueprint

## Purpose

This document defines how to remake and surpass the existing Lovable-created experience. The target is not a normal chatbot. The target is a persistent AI Operations Room: a live business headquarters where defined agents collaborate, delegate, execute, remember, and report.

The current repository is a Vite + React + TypeScript + shadcn/Tailwind Lovable app with Supabase integration. The existing app already has useful pieces: protected routes, an agent chat page, streaming tool events, a call monitor, agent monitoring, Supabase edge functions, and database-backed agent logs/runs. Those pieces should be reused as the frontend shell, but the Ops Room must be upgraded into a real multi-agent orchestration product.

## What the current app already does

The current app has:

- React/Vite frontend routing through `src/App.tsx`.
- A protected `/lovable-agent` page.
- A protected `/monitoring` page.
- A protected `/voiceops` page and redirects from old call routes.
- Supabase client usage.
- A streaming Lovable agent UI that receives `plan`, `tool_start`, `tool_done`, `call_started`, `call_update`, `call_ended`, `secret_request`, and error events.
- A call monitor panel showing live transcript, analyst report, and director strategy.
- An Agent Monitoring page reading `agent_runs` and `agent_logs` from Supabase.
- A Supabase Edge Function at `supabase/functions/lovable-agent/index.ts` that acts as an AI editor/orchestrator.

This is a good start, but it is not yet the Operations Room.

## What is missing

The current app is still mainly a single-agent chat experience with tool-progress panels. It needs to become a persistent multi-agent room.

Missing core systems:

1. Persistent rooms.
2. Multi-agent identities.
3. Shared room event stream.
4. Task board as source of truth.
5. Director/leader orchestration.
6. Hierarchical delegation.
7. Lead agents managing worker agents.
8. Parallel task execution.
9. Persistent memory records.
10. Room-state restoration after reload.
11. Agent-to-agent chat.
12. Review and challenge flow.
13. Action locks for external side effects.
14. Native call records linked to tasks and contacts.
15. VM-ready backend architecture.

## Product target

Build the Ops Room like a company headquarters.

The user should feel like they opened a real office where AI employees are already present, aware, and working together.

The system must support:

- one permanent room per business/project/workspace,
- defined existing agents,
- one Ops Director,
- team leads,
- worker agents,
- shared task board,
- shared event stream,
- persistent memory,
- calls as first-class objects,
- browser automation as first-class work,
- one final coherent response to the user.

## Defined agents

These are the current permanent members of the room:

1. Builder of Agents
2. YTA Assistant
3. Customer Support Agent
4. VAPI Agent
5. Browser Agent

These should not be treated as temporary generated personas. They are stable company workers.

Each agent has:

- `id`
- `display_name`
- `description`
- `specialties`
- `team_id`
- `rank`: director | lead | worker | specialist
- `parent_agent_id`
- `model_provider`
- `model_name`
- `system_instructions`
- `style_profile`
- `tool_permissions`
- `max_parallel_tasks`
- `memory_scope`
- `status`

## Required hierarchy

The room must not be flat. Flat multi-agent chat is too slow and messy.

Use this hierarchy:

```text
Ops Room Director
├── Lead Builder
│   ├── Backend Builder
│   ├── Frontend Builder
│   ├── Tool Integration Builder
│   └── QA / Debug Builder
│
├── Lead Travel / Shopper / YTA Ops
│   ├── Flight Search Agent
│   ├── Hotel Search Agent
│   ├── Car Rental Agent
│   └── Pricing / Policy Agent
│
├── Lead Customer Support
│   ├── WhatsApp Support Agent
│   ├── Email Support Agent
│   └── Complaint Handling Agent
│
├── Lead Calling / VAPI
│   ├── Inbound Call Agent
│   ├── Outbound Call Agent
│   └── Call Summary Agent
│
└── Lead Browser Automation
    ├── Browser Research Agent
    ├── Form Filling Agent
    └── Portal Automation Agent
```

The existing five agents can start as leads/specialists. Later, more worker agents can be added under them.

## Delegation model

Every user request becomes a mission.

The Director receives the mission, creates a top-level mission task, and assigns the mission to the best lead.

The lead decomposes the mission into worker subtasks.

Workers execute subtasks in parallel.

The lead reviews worker results and produces a lead summary.

The Director merges lead summaries and produces the final user answer.

### Example: travel request

User says:

> Find best Hawaii options and message the customer.

Flow:

```text
Director creates mission: Hawaii trip handling
Director assigns to Lead Travel / Shopper
Lead Travel creates subtasks:
  - Flight search -> Flight Search Agent
  - Hotel search -> Hotel Search Agent
  - Pricing/policy check -> Pricing Agent
  - Customer message draft -> Customer Support Agent
Lead Travel reviews outputs
Director approves final answer
```

### Example: app-building request

User says:

> Build the Ops Room backend.

Flow:

```text
Director creates mission: Ops Room backend implementation
Director assigns to Lead Builder
Lead Builder creates subtasks:
  - Database schema -> Backend Builder
  - Controller service -> Backend Builder
  - Realtime stream -> Frontend Builder + Backend Builder
  - Agent registry -> Tool Integration Builder
  - Tests -> QA Builder
Lead Builder reviews outputs
Director decides what is ready for commit
```

## Task model

Tasks are the source of truth. Chat is visibility only.

Each task requires:

```ts
type OpsTask = {
  id: string;
  room_id: string;
  parent_task_id: string | null;
  task_level: "mission" | "lead_task" | "worker_task";
  title: string;
  description: string;
  status: "OPEN" | "CLAIMED" | "ASSIGNED" | "IN_PROGRESS" | "BLOCKED" | "NEEDS_REVIEW" | "DONE" | "ARCHIVED" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  created_by_type: "user" | "agent" | "system";
  created_by_id: string;
  assigned_by_agent_id: string | null;
  lead_agent_id: string | null;
  owner_agent_id: string | null;
  supporter_agent_ids: string[];
  team_id: string | null;
  delegation_path: string[];
  dependency_task_ids: string[];
  blocker_class: string | null;
  blocker_message: string | null;
  action_lock: string | null;
  completion_criteria: string;
  result_summary: string | null;
  review_required_by: string | null;
  approval_status: "not_required" | "pending" | "approved" | "rejected";
  memory_refs: string[];
  call_refs: string[];
  contact_refs: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
```

## Event model

Everything visible in the room is an event.

Required event types:

- USER_GOAL
- MISSION_CREATED
- TASK_CREATED
- TASK_ASSIGNED
- TASK_CLAIMED
- TASK_REASSIGNED
- TASK_STATUS_UPDATED
- DELEGATION_CREATED
- SUBTASK_CREATED
- AGENT_MESSAGE_POSTED
- PROGRESS_UPDATE
- BLOCKER_DECLARED
- HELP_REQUESTED
- SUGGESTION_POSTED
- CHALLENGE_POSTED
- TOOL_ACTION_STARTED
- TOOL_RESULT_POSTED
- DECISION_RECORDED
- REVIEW_REQUESTED
- REVIEW_COMPLETED
- TASK_COMPLETED
- TASK_ARCHIVED
- CALL_STARTED
- CALL_UPDATED
- CALL_ENDED
- CALL_SUMMARIZED
- FOLLOW_UP_CREATED
- MEMORY_SAVED
- FINAL_RESPONSE_CREATED

Event shape:

```ts
type RoomEvent = {
  id: string;
  room_id: string;
  type: string;
  actor_type: "user" | "agent" | "system" | "call";
  actor_id: string;
  related_task_id: string | null;
  parent_event_id: string | null;
  payload: Record<string, unknown>;
  visible: boolean;
  created_at: string;
};
```

## Agent-to-agent chat

Agents must visibly talk to one another.

Do not hide collaboration inside backend logs.

Examples:

```text
Director: Lead Builder, take ownership of the backend architecture. Browser Agent, support with current integration research.
Lead Builder: Accepted. I am splitting this into schema, controller, worker, and realtime subtasks.
Backend Builder: I will handle schema and persistence.
Browser Agent: I will inspect current Supabase patterns and report constraints.
QA Builder: I will wait for implementation then test task transitions.
```

Agent messages should be saved as room events, not only rendered in the UI.

## Director responsibilities

The Director is the top-level organizer.

It must:

- parse user goals,
- create missions,
- choose the best lead,
- prevent duplicate work,
- enforce task ownership,
- enforce action locks,
- decide when parallelism is safe,
- detect stale tasks,
- request review,
- stop unnecessary agent chatter,
- produce final response.

The Director can override leads.

## Lead responsibilities

A lead agent must:

- own a lead task,
- decompose work into worker subtasks,
- assign workers,
- monitor progress,
- ask for help,
- reject weak outputs,
- merge worker outputs,
- create a lead summary,
- escalate blockers to the Director.

## Worker responsibilities

A worker agent must:

- execute assigned subtasks,
- stay within its scope,
- report progress,
- declare blockers,
- return structured output,
- not override the lead,
- not duplicate another worker's work.

## Parallel execution

The system must support parallel worker execution.

Implementation:

- Use Redis queue or Supabase job queue initially.
- Each worker task becomes a queue job.
- Workers emit events while running.
- The lead listens for child task completion.
- Parent task cannot complete until required child tasks complete, cancel, or get bypassed.

## Backend placement

The final architecture should run on a VM or equivalent server.

Lovable/React is only the frontend shell.

The VM should host:

- API server,
- Ops Room controller,
- agent runner,
- worker queue,
- PostgreSQL/Supabase database,
- Redis,
- VAPI webhook handler,
- browser automation worker,
- memory summarizer,
- WebSocket/realtime service.

Recommended VM setup:

```text
Ubuntu VM
Docker Compose
Nginx reverse proxy
PostgreSQL or Supabase external database
Redis
API container
Worker container
Browser automation container
VAPI webhook endpoint
```

## Frontend layout

The current React app should be upgraded with a real Ops Room page.

Recommended route:

```text
/ops-room
```

Required UI panels:

```text
Left Panel:
- rooms
- projects
- contacts
- calls
- agent teams

Center Panel:
- persistent room stream
- user input
- agent-to-agent chat
- tool events
- decisions
- call events

Right Panel:
- task board
- hierarchy tree
- active tasks
- blockers
- active calls
- memory summaries
```

The task board must always be visible.

## Database tables

Minimum tables:

- `ops_rooms`
- `ops_agents`
- `ops_teams`
- `ops_tasks`
- `ops_events`
- `ops_messages`
- `ops_memory_records`
- `ops_calls`
- `ops_contacts`
- `ops_tool_registry`
- `ops_agent_runs`
- `ops_task_reviews`

## Memory model

Memory is shared at room level.

Do not keep isolated memory per agent only.

Memory layers:

1. Live room context
2. Task memory
3. Contact/call memory
4. Business memory
5. Archive memory

Every important event can become a summarized memory record.

Memory records require:

```ts
type MemoryRecord = {
  id: string;
  room_id: string;
  memory_type: "live" | "task" | "business" | "contact" | "call" | "archive";
  source_event_ids: string[];
  summary: string;
  raw_ref: string | null;
  tags: string[];
  related_task_ids: string[];
  related_contact_ids: string[];
  related_call_ids: string[];
  relevance_score: number | null;
  created_at: string;
};
```

## VAPI/call behavior

Calls must be native room objects.

Call flow:

1. Call starts.
2. Create call record.
3. Emit CALL_STARTED.
4. Stream transcript or periodic updates.
5. Emit CALL_UPDATED events.
6. On call end, emit CALL_ENDED.
7. Summarize call.
8. Extract commitments.
9. Create follow-up tasks.
10. Link call to customer/contact and room memory.

## Action locks

Any external side effect needs a lock.

Examples:

- sending email,
- sending WhatsApp,
- placing phone call,
- booking ticket,
- editing GitHub,
- submitting website form,
- charging payment.

Only the task owner can execute the locked action.

Other agents may suggest or challenge, but cannot perform the same side effect.

## How to reuse current app

Reuse:

- App shell and protected routes.
- Supabase auth.
- Existing streaming event UI patterns from LovableAgent.
- Existing call monitor panel concepts.
- Existing AgentMonitoring idea.
- Existing `agent_runs` and `agent_logs` concept, but extend it into Ops Room events.

Do not reuse:

- single-agent-only chat model as the final architecture.
- temporary in-memory frontend message state as source of truth.
- hidden tool logs as replacement for room events.

## MVP build order

### Phase 1: Frontend room shell

- Add `/ops-room` route.
- Create three-panel layout.
- Render mock room events from typed seed data.
- Render agents, teams, and hierarchy.
- Render task board.

### Phase 2: Persistence

- Add database schema.
- Store rooms, agents, tasks, events, messages.
- Reload room state from database.
- User messages create USER_GOAL events.

### Phase 3: Controller

- Implement Director controller.
- User goal creates mission task.
- Director assigns lead.
- Lead creates subtasks.
- Workers update tasks.

### Phase 4: Real agent execution

- Add worker queue.
- Run agents asynchronously.
- Stream events to frontend.
- Support parallel execution.

### Phase 5: Memory

- Add memory records.
- Summarize completed tasks.
- Retrieve relevant memory for new tasks.

### Phase 6: VAPI and Browser

- Add call records and VAPI webhooks.
- Add browser automation worker.
- Link calls and browser results to tasks/events.

## Definition of done

The rebuilt Ops Room is successful when:

- user submits one mission,
- Director creates a mission task,
- a lead receives ownership,
- lead creates child tasks,
- workers execute in parallel,
- all activity is visible as room events,
- task board updates live,
- room state persists after reload,
- call and browser work can become tasks,
- memory records are saved,
- final answer is generated from completed task results.

## Builder warning

Do not build a pretty mockup only.

Do not build a normal chatbot.

Do not build separate agents that do not share state.

Do not hide the work.

Build a persistent, hierarchical, event-driven AI Operations Room.
