# ElevenLabs Agent A / Agent B Transfer Setup

This is the recommended phone-call architecture for this project now.

Canonical prompt source:

- `docs/CanonicalCallAgentPrompts.md`

## Architecture

- `Agent A` = current Maya context
- `Agent B` = duplicate Maya with a new context package
- mid-call context changes happen by `transfer_to_agent`
- transcript carries over
- the target agent continues as the same assistant with a different active instruction set
- the `Director` is the only component that should decide whether to transfer
- live operator instructions should be addressed to the `Director`, not directly to the speaking agent

This is the closest practical equivalent to "injecting new context into the same brain" for live phone calls.

## Repo Support

The token generator now supports explicit agent variants:

- `ELEVENLABS_AGENT_A_ID`
- `ELEVENLABS_AGENT_B_ID`

Backward-compatible env names still work:

- `ELEVENLABS_FAST_AGENT_ID`
- `ELEVENLABS_CONTROL_AGENT_ID`
- `ELEVENLABS_AGENT_ID`

Relevant backend file:

- `supabase/functions/elevenlabs-conversation-token/index.ts`

The token function also accepts:

```json
{
  "task_id": "your-task-id",
  "agent_variant": "A"
}
```

or

```json
{
  "task_id": "your-task-id",
  "agent_variant": "B"
}
```

## Core Prompt Rule

Both agents should share:

- the same voice
- the same identity
- the same disclosure policy
- the same speaking style

The only meaningful difference should be the active context/instruction package.

Each prompt should explicitly say:

```text
You are continuing the same live phone conversation.
Do not re-introduce yourself.
Do not announce that a transfer happened.
Continue naturally as the same assistant.
Apply the context below immediately.
```

## Agent A Prompt Guidance

Agent A is just Maya in her normal operating context.

Add this handoff rule:

```text
If a different context package is needed, use the transfer_to_agent tool and hand off the live conversation to the correct Maya variant.
```

## Agent B Prompt Guidance

Agent B is Maya with a different instruction package.

Add this continuation block near the top:

```text
You are still Maya.
You are continuing a transferred live conversation as the same assistant.
The prior transcript remains authoritative.
Your job is to apply the new context package below without breaking the conversational flow.
Do not re-greet.
Do not mention internal routing.
```

## Director / Transfer Agent Constraint

This is the important part:

The Director should be the sole routing authority, and it must be extremely terse.

Why:

- whatever it says becomes the transfer instruction
- if it rambles, the handoff becomes noisy and unstable

So configure the transfer-deciding prompt like this:

```text
When deciding a transfer, output only the minimum necessary direction.

Rules:
- Be extremely brief.
- No explanations.
- No chain-of-thought.
- No natural-language conversation to the caller.
- Output only the handoff directive needed to route the conversation.
- If no transfer is needed, output a short no-transfer decision.

Examples:
- TRANSFER: Agent B
- TRANSFER: Agent A
- NO_TRANSFER
```

If your transfer logic is embedded in a tool call prompt, keep the transfer criteria equally short:

```text
Transfer only when the conversation needs a new context package.
When transferring, choose the correct target agent and do not add extra commentary.
```

## Dynamic Variables

The token generator already sends:

- `task_id`
- `agent_variant`
- `mode`
- `objective`
- `goal`
- `constraints`
- `script`
- `director_notes`
- `analyst_notes`
- `operator_instruction`
- `fast_context`
- `current_date_central`
- `speech_formatting_rules`

It also sends `conversation_initiation_client_data` including:

- `call_objective`
- `constraints`
- `agent_name`
- `agent_role_title`
- `company_name`
- `call_type`
- `success_criteria`
- `allowed_actions`
- `script`
- `ai_disclosure_policy`
- `current_date`
- `task_id`
- `agent_variant`

## Transfer Strategy

Use transfer for things like:

- user chooses a specific option and the context package should change
- negotiation stance changes
- purchase strategy changes
- new product path should take over
- one Maya variant should finish the rest of the call

This does not need to be temporary.

`Agent B` can simply continue to the end of the call if that is cleaner.

## Example Mental Model

- `Agent A` = Maya in browsing/comparison mode
- `Agent B` = Maya in purchase/closing mode

The user says:

- "Take the last option"
- "Ask about the other product"
- "Take that deal"

Agent A then transfers to Agent B, and Agent B continues the same call with the new active context.

## Recommended Guardrails

- Keep transfer count low.
- Avoid bouncing back and forth unless needed.
- Keep agent identity stable across variants.
- Keep target prompts explicit about seamless continuation.
- Keep the transfer-decider output minimal.

## Env Vars

Set these in Supabase:

- `ELEVENLABS_AGENT_A_ID`
- `ELEVENLABS_AGENT_B_ID`
- `ELEVENLABS_CONVAI_KEY`
- `ELEVENLABS_PHONE_NUMBER_ID`
- `OPENAI_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

## Deploy

```bash
supabase functions deploy elevenlabs-conversation-token
```

If you also changed other functions:

```bash
supabase functions deploy voice-agent
supabase functions deploy convai-llm-relay
```
