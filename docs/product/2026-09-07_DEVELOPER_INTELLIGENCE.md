# Bikorch — Developer Intelligence / Profile / Memory

**Decision date:** 2026-09-07  
**Priority:** P0  
**Status:** Approved product requirement  
**Audience:** AI coding agent

## 1. Objective

Build a profile system that does more than display account details.

Bikorch should progressively understand how the developer works by analyzing:

- prompts
- project context
- agent usage
- files and languages involved
- Git activity
- AI account usage
- token and cost data when available
- work categories
- session patterns

The result should be a user-controlled **Developer Intelligence** layer.

This module must have three clearly separated concepts:

1. **History** — raw or structured activity records.
2. **Metrics** — measurable statistics derived from activity.
3. **Memory** — AI-generated or user-defined semantic facts/preferences.

Do not mix these into a single table or opaque AI profile.

---

## 2. Main navigation

Add a Profile entry to the existing application navigation.

Suggested sections:

- Overview
- Developer Insights
- AI Accounts
- Usage & Costs
- Prompt History
- Memory
- Privacy & Data

Profile should be accessible without replacing the existing workspace.

---

## 3. Overview

The overview should support date ranges such as:

- Today
- 7 days
- 30 days
- This month
- All time

Show only metrics backed by real data.

Suggested cards:

- Prompts sent
- Sessions
- Active projects
- AI providers used
- Total tokens
- Input tokens
- Output tokens
- Cached tokens
- Estimated/API spend
- Subscription spend
- Total AI spend
- Average prompt size
- Average session duration
- Most active time period

If a metric cannot be reliably measured, show `Unavailable` rather than inventing a number.

---

## 4. Prompt History

Create a persistent structured prompt history.

Suggested model:

```ts
interface PromptRecord {
  id: string
  createdAt: number
  projectId?: string
  sessionId?: string
  provider?: string
  accountId?: string
  prompt: string
  promptHash?: string
  source: 'terminal' | 'web-chat' | 'handoff' | 'other'
  languageHints?: string[]
  category?: string
  inputTokenCount?: number
  outputTokenCount?: number
  cachedTokenCount?: number
  costUsd?: number
  costSource?: 'official' | 'estimated'
}
```

Important:

- Do not capture passwords, tokens or secrets.
- Do not blindly store all terminal input as a prompt.
- Shell commands and AI prompts need different event types.
- Prompt capture must be user-visible and controllable.
- The user must be able to disable prompt retention.
- The user must be able to delete history.

Provide filters:

- provider
- project
- date
- category
- source
- search text

---

## 5. Event foundation

Prefer a generic activity-event architecture rather than coupling every feature directly to the Profile screen.

Example:

```ts
type DeveloperEventType =
  | 'prompt.sent'
  | 'agent.session.started'
  | 'agent.session.ended'
  | 'git.commit'
  | 'git.file.changed'
  | 'project.opened'
  | 'usage.snapshot'
  | 'task.started'
  | 'task.completed'

interface DeveloperEvent {
  id: string
  type: DeveloperEventType
  occurredAt: number
  projectId?: string
  sessionId?: string
  provider?: string
  accountId?: string
  payload: Record<string, unknown>
}
```

Use typed payloads in implementation even if the conceptual model is generic.

Do not leak this event stream to third-party analytics by default.

---

## 6. Developer metrics

### 6.1 Languages

Show a distribution such as:

```text
TypeScript 42%
Go         31%
JavaScript 14%
Python      8%
Other       5%
```

The metric must be named clearly, for example:

**Language activity distribution**

Do not present it as developer skill level.

Signals can include:

- project file extensions
- files modified during sessions
- Git changed files
- active project language composition
- code blocks in prompts
- explicit user preference

Prompt mentions alone are insufficient.

Store `unknown` where classification is uncertain.

### 6.2 Frameworks and technologies

Possible categories:

- React
- Electron
- Next.js
- NestJS
- Node.js
- Go standard library
- Docker
- PostgreSQL

Use confidence/evidence, not single keyword matches.

### 6.3 Work categories

Classify activity into categories such as:

- Feature development
- Debugging
- Refactoring
- Testing
- Architecture
- DevOps
- Documentation
- Research
- Code review

### 6.4 Workflow metrics

Examples:

- most-used agent
- most-used project
- average AI session duration
- common agent sequence
- sessions ending in Git commit
- tasks completed with AI
- prompts per session
- provider usage distribution

---

## 7. AI Accounts

Reuse the existing account infrastructure.

Show per account:

- provider
- account identity
- plan type where available
- usage windows
- current usage percentage
- resets-at date
- credits/balance where officially exposed
- renewal date where reliably known
- manually configured subscription price
- status

Do not fabricate renewal dates or credit balances.

Allow manual subscription entries when provider APIs do not expose billing data.

Suggested manual subscription model:

```ts
interface SubscriptionRecord {
  id: string
  accountId?: string
  provider: string
  planName?: string
  amount: number
  currency: string
  billingPeriod: 'monthly' | 'yearly' | 'custom'
  renewalDate?: number
  source: 'manual' | 'provider'
}
```

---

## 8. Usage & Costs

Separate cost sources.

### Subscription cost

Examples:

- Claude Pro
- ChatGPT Plus/Pro
- Cursor Pro
- Gemini plan

### Metered API cost

Examples:

- OpenAI API
- Anthropic API
- Gemini API

Do not merge them internally.

Suggested dashboard:

```text
Monthly AI Cost

Subscriptions   $60.00
API Usage       $34.18
Total           $94.18
```

Breakdowns:

- provider
- account
- project
- date
- model where available

Token details:

- input
- output
- cached
- total

Mark values as:

- Official
- Estimated
- Unavailable

Do not calculate exact CLI token usage from terminal output length.

---

## 9. Developer Memory

Memory is semantic, not raw history.

Suggested model:

```ts
type MemoryScope = 'global' | 'project'

interface DeveloperMemory {
  id: string
  scope: MemoryScope
  projectId?: string
  category: string
  content: string
  confidence: number
  evidenceCount: number
  firstSeenAt: number
  lastSeenAt: number
  source: 'ai' | 'user'
  enabled: boolean
}
```

Examples:

- Prefers TypeScript strict mode.
- Avoids `any` where practical.
- Prefers small React components.
- Uses Go mainly for backend services.
- Prefers plan → implement → review workflows.

The user must be able to:

- view memory
- edit memory
- delete memory
- disable individual memories
- create manual memory
- clear all AI-generated memories

---

## 10. AI analysis engine

Do not send every historical prompt to a model.

Use a pipeline:

```text
New events
  ↓
Local preprocessing
  ↓
Secret redaction
  ↓
Batch selection
  ↓
AI analysis
  ↓
Memory candidate
  ↓
Evidence/confidence update
```

Analysis should run:

- manually
- periodically
- or after a meaningful event threshold

Avoid recalculating the profile after every keystroke.

---

## 11. Context retrieval

Future agent prompts should be able to request relevant memory.

Conceptual flow:

```text
Current prompt
+
Current project
+
Relevant memory
+
Relevant project history
=
Context package
```

Do not inject all memory by default.

Use relevance and scope.

Suggested rules:

- project memory before unrelated global memory
- hard token budget
- no disabled memory
- no sensitive fields
- user option to preview injected context

---

## 12. Embeddings / retrieval

Embedding-based retrieval is allowed as an implementation strategy but is not mandatory for the first slice.

Start simple if necessary:

- categories
- project scope
- recency
- keyword matching

Then add vector search when data volume justifies it.

Do not introduce a remote vector database as a mandatory dependency for local users.

---

## 13. API key security

Any AI analysis API key must not live in renderer localStorage.

Flow:

```text
Renderer
  ↓
Validated IPC
  ↓
Main process
  ↓
Secure credential storage
  ↓
Provider API
```

Prefer OS-backed secure storage where practical.

Never log secrets.

Do not place API keys in:

- Git repository
- plain renderer state
- console output
- generic logs
- exported profile files

---

## 14. Secret redaction

Before external AI analysis, detect and redact likely secrets.

Examples:

- API keys
- access tokens
- bearer tokens
- private keys
- `.env` values
- passwords
- auth headers
- connection strings

Example transformation:

```text
OPENAI_API_KEY=sk-...
```

to:

```text
OPENAI_API_KEY=[REDACTED]
```

Redaction must happen before outbound network requests.

---

## 15. Privacy settings

Required controls:

```text
Developer Intelligence

[ ] Save prompt history
[ ] Analyze prompts with AI
[ ] Use project file context for metrics
[ ] Use Git activity for metrics
[ ] Include memory in future prompts
[ ] Keep local usage history
```

External AI analysis must require explicit opt-in.

Add:

- retention period
- export data
- delete history
- delete memories
- clear metrics cache
- reset profile

---

## 16. Profile insight examples

Example:

```text
Developer Insights

Language activity

TypeScript 42%
Go         31%
JavaScript 14%
Python      8%

Main activity

Feature development 34%
Debugging           23%
Refactoring         17%

AI workflow

Most used agent:
Codex

Most common workflow:
Plan → Implement → Review
```

Possible AI-generated insights:

```text
Your Go activity increased from 18% to 31% this month.

You frequently use Claude for planning and Codex for implementation.
```

Every AI-generated insight should be treated as an interpretation, not a fact.

---

## 17. Suggested implementation structure

Adapt to current repository conventions.

Possible structure:

```text
src/shared/contracts/developer-intelligence.ts

src/main/developer-intelligence/
├── event-store.ts
├── prompt-store.ts
├── metrics-service.ts
├── memory-service.ts
├── redaction.ts
└── analysis-provider.ts

src/main/ipc/
└── developer-intelligence.ts

src/renderer/stores/
└── developer-intelligence-store.ts

src/renderer/components/profile/
├── ProfileView.tsx
├── ProfileOverview.tsx
├── DeveloperInsights.tsx
├── AiCosts.tsx
├── PromptHistory.tsx
├── MemoryManager.tsx
└── PrivacySettings.tsx
```

Do not create these files mechanically if equivalent abstractions already exist.

---

## 18. Recommended implementation phases

### Phase A — Foundation

- Profile navigation
- persistence schema
- activity events
- prompt history
- privacy toggles
- filtering/deletion
- tests

### Phase B — Metrics

- prompt/session counts
- project usage
- provider usage
- language activity
- work categories
- trend calculations

### Phase C — Costs/accounts

- reuse current CLI usage
- manual subscription data
- provider usage data
- API token/cost ingestion
- budgets and forecasts

### Phase D — Memory

- AI analysis provider
- redaction
- memory extraction
- confidence/evidence
- global/project memory
- editor/delete controls

### Phase E — Context engine

- relevance retrieval
- prompt-context preview
- opt-in context injection
- agent handoff integration

---

## 19. Acceptance criteria

The feature is not complete until:

- Profile opens from normal app navigation.
- Metrics are backed by persisted real data.
- Raw prompt retention can be disabled.
- Stored prompts can be searched and deleted.
- No secret is intentionally sent to an AI provider.
- User controls external analysis.
- Language percentages clearly describe their basis.
- AI-generated memories can be reviewed, edited and deleted.
- Provider costs distinguish subscriptions and API usage.
- Unknown provider data is shown as unavailable rather than invented.
- Restarting the application preserves opted-in data.
- Typecheck/build pass.
- Critical metrics, redaction and memory logic have tests.
