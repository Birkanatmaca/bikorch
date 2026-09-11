# Bikorch — Background Automation System

**Decision date:** 2026-09-11  
**Status:** Implementation plan; not yet implemented  
**Priority:** P0 product capability, gated by P0 security hardening  
**Audience:** Product owner and implementation agents

## 1. Outcome

Bikorch will gain a local, persistent automation system for running AI CLI tasks on a schedule.

The product behavior will be:

- Add an **Automations** entry to the existing activity rail, immediately above the Music icon.
- Keep Bikorch's background process alive when the workspace window is closed.
- Show a native system tray/menu-bar icon while Bikorch is running in the background.
- Start Bikorch in background mode at operating-system login when background automations are enabled.
- Run due jobs while the computer is awake and the Bikorch main process is running.
- Reconcile schedules after app restart, system wake, clock/time-zone changes, and internet recovery.
- Collapse any number of missed occurrences into **one catch-up run per automation**. Missed occurrences must never produce a backlog.
- Run CLIs through provider-specific, non-interactive executor adapters owned by the Electron main process.
- Use an isolated Git worktree by default for jobs that may edit code.
- Persist definitions, scheduler state, run history, and bounded logs in dedicated SQL tables.
- Require an explicit dangerous-mode opt-in before any unsandboxed/full-access execution.

This module is separate from the existing Tasks feature. Tasks are human-managed work items; Automations are executable schedules with run history and security policy.

## 2. Product decisions

### 2.1 Background behavior

Closing the main window will hide it instead of terminating Bikorch while background mode is enabled. The Electron main process, scheduler, runner, connectivity monitor, and tray icon will remain active.

The application exits only when the user selects **Quit Bikorch** from the tray/menu, disables background mode and closes the final window, the operating system shuts down, or the process crashes.

At login:

- Bikorch starts with a `--background` argument.
- The tray icon and main-process services are initialized.
- The workspace window is not shown until the user selects **Open Bikorch**.
- Schedule reconciliation starts after persistence and executor services are ready.

The first automation creation flow should enable **Run Bikorch in background** and **Start at login** by default, while making both settings visible and reversible.

### 2.2 Missed-run policy

The initial release has one supported missed-run policy:

```text
coalesce-one
```

If a daily automation should run at 09:00 and Bikorch is unavailable for five days, the next startup creates one catch-up run representing the latest missed schedule slot. It does not create five runs.

The same rule applies when:

- the app process was not running;
- the computer was asleep or powered off;
- the executor needed internet access but connectivity was unavailable;
- a previous run of the same automation was still active.

### 2.3 Execution guarantees

The scheduler provides these guarantees:

- At most one active run for the same automation.
- At most one pending catch-up marker for the same automation.
- At most one run record for a specific calculated schedule slot.
- No enumeration or insertion of every missed historical slot.
- A manual run does not move the next scheduled time.
- A disabled automation does not accumulate missed work.

This is not a distributed exactly-once system. If the process crashes after an external side effect but before persisting completion, blindly replaying the run could duplicate that side effect. Therefore interrupted active runs are marked `interrupted` and require resume/review rather than automatic duplication in the first release.

## 3. Current repository integration points

The plan is based on the current implementation:

- `src/main/index.ts` creates the only `BrowserWindow`, currently quits on `window-all-closed` outside macOS, and has no tray/background lifecycle.
- `src/renderer/components/layout/SidebarActivityBar.tsx` owns the activity-rail buttons. The Automations button must be inserted immediately before the existing Music button.
- `src/renderer/components/layout/WorkspaceLayout.tsx`, `LeftSidebar.tsx`, `src/renderer/stores/workspace-store.ts`, and `src/shared/types/index.ts` share the current sidebar-view union.
- `src/main/persistence/database.ts` owns the sql.js database and already initializes bounded-domain tables for Developer Intelligence, Music, and downloads.
- `src/main/music/downloader/queue.ts` provides a useful local pattern for persistent jobs, recovery, cancellation, concurrency, and event broadcasting.
- `src/main/cli/adapters.ts` resolves installed CLI executables, but its current adapters launch interactive terminals.
- `src/main/cli/pty-manager.ts` is renderer-session-oriented and must not be used as the automation scheduler's core runner.
- `src/main/git/worktrees.ts` already creates managed agent worktrees and can be generalized for automation run IDs.
- `src/preload/index.ts` and `src/main/ipc/index.ts` are the integration points for a narrow automation API.
- `src/renderer/lib/persistence-sync.ts` persists renderer-owned workspace state. Automation domain data should not be added to that whole-snapshot path.

## 4. UX design

### 4.1 Activity rail

Add a `CalendarClock` or `Workflow` icon from `lucide-react` immediately above `Music2`.

The button states are:

- default: no badge;
- scheduled jobs enabled: subtle clock/status dot;
- one or more running: animated green indicator and running count;
- waiting for network: amber dot;
- failed or needs attention: red badge;
- active sidebar: existing `glass-icon-btn-active` styling.

Accessible labels should include the useful state, for example:

```text
Show automations, 1 running, 2 enabled
Show automations, 1 needs attention
Hide automations
```

### 4.2 Automation sidebar

The Automations view is a wide sidebar view, like Accounts and Profile. It contains:

1. Header with `Automations`, a global pause toggle, and **New**.
2. Compact health strip showing `Running`, `Waiting`, `Failed`, and `Next`.
3. Project filter defaulting to the active project, with an **All projects** option.
4. Automation cards ordered by running/attention state and next-run time.
5. Run-history drawer or detail view for the selected automation.

Each card shows:

- name and enabled toggle;
- executor/provider and account label;
- human-readable schedule and IANA time zone;
- next run;
- last result and duration;
- pending catch-up/network status;
- **Run now**, **Edit**, **History**, and overflow actions.

Empty state copy:

```text
Run repeatable AI tasks on a schedule.
Create your first automation.
```

### 4.3 Create/edit form

The form fields are:

- Name
- Project
- Task prompt/instructions
- Executor/provider
- Account/profile when supported
- Schedule type: once, daily, weekdays, weekly, interval, advanced cron
- Local time and days where applicable
- Time zone, initialized from `Intl.DateTimeFormat().resolvedOptions().timeZone`
- Run workspace: isolated worktree by default; shared folder only with explicit warning
- Permission profile
- Network policy
- Timeout
- Completion/failure notification settings
- Retention setting for run output

The UI states the missed-run rule directly:

> If Bikorch, the computer, or the internet is unavailable, missed times are combined into one run when service returns.

### 4.4 Permission profiles

Expose user-oriented profiles rather than raw CLI flags:

| Profile | Filesystem | Approval behavior | Intended use |
| --- | --- | --- | --- |
| Observe | Read-only | Never prompt | Reports, review, summaries |
| Edit workspace | Isolated workspace write | Never prompt within boundary | Scheduled code fixes and tests |
| Review automatically | Workspace write | Provider auto-review when supported | Work needing controlled exceptions |
| Ask me | Workspace write | Pause and notify | Interactive/high-risk workflows |
| Full access | Unrestricted | Never prompt | Advanced, dangerous, isolated environments only |

`Full access` is hidden under Advanced settings, requires a per-automation confirmation, and is never selected by migration or default.

## 5. Background and tray lifecycle

Create `BackgroundLifecycleService` in the main process.

Responsibilities:

- Hold the single-instance lock with `app.requestSingleInstanceLock()`.
- Own a nullable `mainWindow` reference and recreate/show/focus it on demand.
- Track `isQuitting` so an explicit quit is not converted into hide-to-tray.
- Intercept window close while background mode is enabled, prevent default, and hide the window.
- Keep running when `window-all-closed` fires.
- Register start-at-login behavior.
- Initialize and update the tray icon and menu.
- Flush automation state and stop child processes during explicit shutdown.
- Reconcile schedules on `powerMonitor` resume and unlock events.

Tray/menu items:

```text
Open Bikorch
Automations: 1 running · 3 enabled
Run pending automations
Pause all automations
Start at login              ✓
Open automation history
Quit Bikorch
```

Asset plan:

- Add monochrome macOS template PNGs at 16px and 32px (`Template`/`Template@2x`).
- Add Windows/Linux tray PNG variants at 16px, 20px, 24px, and 32px.
- Use the existing application icon only as a development fallback.
- Add normal, active, waiting, and attention variants or render a small status overlay in the main process.

Platform startup:

- macOS/Windows: `app.setLoginItemSettings` with `--background` for packaged builds.
- Linux: install/remove a user autostart `.desktop` entry in the supported packaging flow.
- Development builds do not modify OS login items unless an explicit developer override is enabled.

The tray/background process is the reliability boundary. A separately installed system daemon is not part of the first release. If immediate restart after a main-process crash becomes a hard requirement, add an OS-native watchdog as a later deliverable; login startup alone cannot guarantee immediate crash recovery.

## 6. Scheduler design

Create a main-process-only `AutomationScheduler`. It starts only after the database, accounts, and executor registry are initialized.

Do not put scheduling timers in React, Zustand, a `BrowserWindow`, or renderer localStorage. The workspace window may not exist in background-start mode.

### 6.1 Timer strategy

- Persist absolute `next_run_at` timestamps.
- Calculate occurrences using an IANA-time-zone-aware recurrence library.
- Use a short, capped wake timer rather than one timer spanning days.
- Reconcile at startup, every scheduler tick, system resume/unlock, connectivity recovery, definition updates, and clock/time-zone changes.
- Recalculate the next future occurrence from `now`; do not repeatedly add fixed milliseconds for calendar schedules.
- Serialize scheduler reconciliation so overlapping triggers cannot claim the same work twice.

Initial supported schedule models:

```ts
type AutomationSchedule =
  | { kind: 'once'; runAt: number; timeZone: string }
  | { kind: 'daily'; localTime: string; timeZone: string }
  | { kind: 'weekdays'; localTime: string; timeZone: string }
  | { kind: 'weekly'; days: number[]; localTime: string; timeZone: string }
  | { kind: 'interval'; everyMinutes: number; anchorAt: number }
  | { kind: 'cron'; expression: string; timeZone: string }
```

Use a vetted recurrence dependency rather than maintaining custom DST/cron parsing. Pin its version and wrap it behind `ScheduleCalculator` so it can be replaced without changing the domain model.

### 6.2 Coalescing algorithm

Reconciliation must not enumerate all missed occurrences.

Pseudocode:

```ts
for (const automation of enabledAutomations) {
  const latestDueSlot = schedule.latestOccurrenceAtOrBefore(now)

  if (latestDueSlot && latestDueSlot >= automation.nextRunAt) {
    repository.markCatchUpPending({
      automationId: automation.id,
      scheduledFor: latestDueSlot // replaces any older pending slot
    })
    repository.setNextRunAt(automation.id, schedule.nextOccurrenceAfter(now))
  }

  if (automation.pendingCatchUp && connectivity.canRun(automation)) {
    queue.claimOnePendingRun(automation.id)
  }
}
```

The actual implementation performs the pending claim and run insertion in one database transaction.

Example:

```text
Schedule: every day at 09:00
App last ran: Monday 08:00
App starts: Thursday 14:00

Result:
- pending scheduled slot = Thursday 09:00
- one catch-up run is queued immediately
- next run = Friday 09:00
- Tuesday and Wednesday do not become run rows
```

### 6.3 Offline behavior

Connectivity is an execution prerequisite, not a queue generator.

- If a network-required automation becomes due while offline, set/replace its single pending catch-up marker.
- Do not create a fresh waiting run for each scheduler tick.
- When connectivity returns, atomically consume the marker into one run.
- A network preflight failure does not consume the run's retry budget.
- If connectivity is lost after the CLI starts and the executor reports a network-classified failure, keep the same run record and allow bounded retry after recovery.
- After the retry budget is exhausted, mark that run failed; future scheduled occurrences remain eligible.

Create a main-process `ConnectivityMonitor`:

- Fast local signal for clearly offline state.
- Provider-specific unauthenticated reachability probe with a short timeout; any valid HTTP response can establish reachability.
- Probe only while a network-required run is pending or at a low background frequency.
- Trigger immediately on startup, system resume, and an executor-classified network failure.
- Never log credentials, authorization headers, or prompt content from probes.

### 6.4 Overlap and concurrency

Defaults:

- Global automation concurrency: 2.
- Per-project concurrency: 1 for code-writing jobs.
- Per-automation concurrency: 1.
- Manual read-only jobs may run concurrently when they target different projects.

If a scheduled time arrives while that automation is active, update its one pending catch-up marker to the latest due slot. When the active run ends, one coalesced run may start.

## 7. Run state machine

```text
queued
  ├─> waiting-network ─> queued
  ├─> preparing ─> running ─> succeeded
  │                    ├─> failed
  │                    ├─> cancelled
  │                    ├─> interrupted
  │                    └─> needs-attention
  └─> cancelled
```

Statuses:

```ts
type AutomationRunStatus =
  | 'queued'
  | 'waiting-network'
  | 'preparing'
  | 'running'
  | 'needs-attention'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
```

Startup recovery:

- `queued` and `waiting-network` runs are recovered as the same run row.
- `preparing` and `running` runs from the previous process are marked `interrupted`.
- Interrupted runs are not silently replayed.
- The associated managed worktree is retained for inspection/resume.
- A later provider adapter may support an explicit safe resume using a persisted provider session ID.

## 8. Persistent data model

Automation data belongs in dedicated SQL tables initialized from `src/main/automation/store.ts`. Follow the existing Music/download domain-store pattern and keep an independent `automation_schema_version` meta key.

Do not add automation definitions or run logs to `PersistedSnapshot`; renderer snapshot saves must not be able to overwrite scheduler-owned state.

### 8.1 Definitions

```sql
CREATE TABLE automation_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  executor_kind TEXT NOT NULL,
  account_id TEXT,
  schedule_json TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  worktree_mode TEXT NOT NULL,
  permission_profile TEXT NOT NULL,
  approval_policy TEXT NOT NULL,
  network_policy TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL,
  max_retries INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,
  pending_catch_up INTEGER NOT NULL DEFAULT 0,
  pending_scheduled_for INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Indexes:

- `(enabled, next_run_at)`
- `(project_id, enabled)`
- `(pending_catch_up)`

### 8.2 Runs

```sql
CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  scheduled_for INTEGER,
  slot_key TEXT,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  exit_code INTEGER,
  provider_session_id TEXT,
  worktree_path TEXT,
  summary TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (automation_id) REFERENCES automation_definitions(id)
);
```

Add a unique partial rule equivalent to `(automation_id, slot_key)` when `slot_key` is non-null. Manual runs use a random/manual key and do not consume scheduled slots.

### 8.3 Events and settings

`automation_run_events` stores bounded structured output with `(run_id, sequence)` uniqueness. Cap event count and payload size per run; retain the final summary separately.

`automation_settings` stores:

- background mode;
- start at login;
- notifications;
- global pause;
- concurrency;
- run/event retention;
- first-close tray education state.

Default retention is 90 days for terminal runs and 30 days for verbose events. Cleanup never deletes an active run or its retained worktree.

## 9. Executor architecture

Create a separate automation executor layer rather than extending interactive PTY behavior with prompt scraping.

```ts
interface AutomationExecutorAdapter {
  kind: AutomationExecutorKind
  detect(): Promise<ExecutorCapabilities>
  preflight(context: RunContext): Promise<PreflightResult>
  buildInvocation(context: RunContext): SpawnInvocation
  parseStdout(line: string, context: RunContext): AutomationEvent | null
  classifyFailure(result: ProcessResult): AutomationFailure
}
```

Common runner requirements:

- Use `child_process.spawn` with `shell: false`.
- Pass command and arguments as separate values.
- Do not concatenate prompts into a shell command.
- Use a minimal, controlled environment and the selected account/profile integration.
- Stream bounded stdout/stderr to run events.
- Enforce timeout and output limits.
- Kill the child process tree on cancellation/shutdown.
- Redact tokens, known secret patterns, and credential paths before persistence/broadcast.
- Record the resolved executable and capability version, but not secrets.

### 9.1 Codex vertical slice

Codex is the first production executor because its official non-interactive interface is designed for pipelines and scheduled jobs.

Use:

- `codex exec` rather than the interactive TUI;
- `--json` for JSONL event parsing;
- an explicit sandbox and approval policy derived from the selected permission profile;
- `workspace-write` in an isolated worktree as the default editing mode;
- `read-only` for report/review tasks;
- `danger-full-access` only behind the dangerous-mode gate and preferably inside an external container boundary.

At runtime, inspect `codex exec --help` once per detected CLI version and store capabilities. If the installed version does not support the required non-interactive flags, fail preflight with an actionable UI message instead of falling back to an interactive terminal.

Official OpenAI documentation states that `codex exec` is intended for scripts, CI, and scheduled jobs, supports explicit sandbox/approval settings, and can emit JSONL events. It also recommends least privilege and controlled isolation for `danger-full-access`: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).

The documented approval/sandbox combinations, `--ask-for-approval never`, auto-review, and the dangerous bypass mode are described in [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security).

### 9.2 Other CLIs

Add provider adapters only after verifying a stable, documented non-interactive command and exit/event contract for the installed version.

An adapter capability response includes:

```ts
interface ExecutorCapabilities {
  installed: boolean
  version?: string
  supportsNonInteractive: boolean
  supportsStructuredEvents: boolean
  supportsReadOnly: boolean
  supportsWorkspaceWrite: boolean
  supportsAutoReview: boolean
  supportsAccountSelection: boolean
}
```

If a CLI lacks safe non-interactive execution, the UI may allow **Open interactively** but must not claim it supports background automation. Never auto-type `y`, scrape a changing approval prompt, or emulate a user response as the security mechanism.

## 10. Worktree and change handling

Editing automations default to a managed Git worktree created from the selected project.

- Generalize `ensureAgentWorktree` to accept an automation/run owner while preserving current panel behavior.
- Branch naming: `bikorch/automation/<automation-slug>/<run-short-id>`.
- Store the worktree path on the run before starting the executor.
- Do not automatically merge, push, publish, deploy, or delete the branch.
- On success with changes, retain the worktree and show **Review changes**.
- On success with no changes, clean up automatically after the result is persisted.
- On failure/interruption, retain it until the user discards or accepts it.
- Add a retention/cleanup screen for orphaned worktrees.

For non-Git folders, `workspace-write` runs in the project folder only after the user explicitly accepts the lack of isolation. The default fallback is read-only.

## 11. IPC and renderer state

Add `src/shared/contracts/automation.ts` with strict domain types, limits, request/response contracts, and event unions.

IPC surface:

```text
automation:list
automation:get
automation:create
automation:update
automation:remove
automation:setEnabled
automation:runNow
automation:cancelRun
automation:listRuns
automation:getRun
automation:deleteRun
automation:updateSettings
automation:getStatus
automation:event
```

Rules:

- Validate every request in the main process.
- Enforce maximum prompt/name lengths, time-zone validity, schedule bounds, project-root ownership, and enum values.
- Validate that `projectId` resolves to the stored project folder; never accept an arbitrary execution `cwd` from renderer input.
- Do not expose raw process spawning, executable paths, environment mutation, or arbitrary CLI arguments.
- Broadcast sanitized domain events only.
- On renderer reconnect, load a fresh snapshot before subscribing to events to avoid gaps.

Create `useAutomationStore` for UI cache and commands. The main-process repository remains authoritative.

## 12. Security gate

Automation adds unattended code execution, so it cannot safely ship on top of the current privileged-renderer exposure identified in the repository review.

Before enabling execution:

1. Remove remote YouTube iframe API script execution from the main privileged renderer or isolate it in a renderer/webContents with no Bikorch preload API.
2. Narrow preload exposure and ensure embedded remote content cannot access automation, PTY, filesystem, Git, account, or credential IPC.
3. Add trusted-sender validation to privileged IPC handlers.
4. Restrict navigation, new-window URLs, webview attachment, permissions, and external protocols.
5. Resolve filesystem roots through real paths and reject symlink escapes.
6. Keep provider credentials in the existing secure account/profile layer; never copy them into automation tables or logs.
7. Redact prompt output and command events before persistence.
8. Make full access an explicit per-definition decision and show its exact filesystem/network scope.

Additional policy:

- Background jobs cannot execute arbitrary UI-supplied commands.
- Definitions store structured policy, not free-form flags.
- Deploy, publish, push, credential changes, destructive Git operations, and deletion outside a managed worktree require interactive user authorization or are denied.
- Notifications show automation name and status, not prompt content or secrets.

## 13. Notifications and attention states

Use Electron `Notification` from the main process.

Notify for:

- catch-up run started;
- run succeeded when the setting is enabled;
- run failed;
- account/login missing;
- manual approval or attention required;
- repeated offline deferral only after a sensible threshold, not every probe.

Clicking a notification opens Bikorch and navigates to the related automation/run.

The tray tooltip/menu and sidebar badge must derive from the same main-process aggregate status to avoid conflicting counts.

## 14. File-level implementation map

### New files

```text
src/shared/contracts/automation.ts
src/main/automation/store.ts
src/main/automation/schedule-calculator.ts
src/main/automation/scheduler.ts
src/main/automation/queue.ts
src/main/automation/runner.ts
src/main/automation/connectivity.ts
src/main/automation/service.ts
src/main/automation/executors/types.ts
src/main/automation/executors/codex.ts
src/main/ipc/automation.ts
src/main/lifecycle/background.ts
src/main/lifecycle/tray.ts
src/renderer/stores/automation-store.ts
src/renderer/components/automation/AutomationPanel.tsx
src/renderer/components/automation/AutomationEditor.tsx
src/renderer/components/automation/AutomationCard.tsx
src/renderer/components/automation/AutomationRunDetail.tsx
src/renderer/components/automation/AutomationEmptyState.tsx
```

### Modified files

```text
src/main/index.ts
src/main/ipc/index.ts
src/preload/index.ts
src/shared/types/index.ts
src/main/persistence/database.ts
src/main/git/worktrees.ts
src/renderer/App.tsx
src/renderer/components/layout/SidebarActivityBar.tsx
src/renderer/components/layout/WorkspaceLayout.tsx
src/renderer/components/layout/LeftSidebar.tsx
src/renderer/stores/workspace-store.ts
src/renderer/styles/workstation.css
package.json
electron-builder configuration/assets
```

`src/main/persistence/database.ts::parseLayout` must accept the new `automation` sidebar view so it survives restart. The wide-sidebar calculation in `WorkspaceLayout.tsx` must also include `automation`.

## 15. Delivery phases

### Phase 0 — Security and lifecycle foundation

- Complete the privileged-renderer/remote-content security gate.
- Refactor `mainWindow` ownership out of the local `createWindow` scope.
- Add single-instance behavior.
- Add tray/menu, close-to-tray, explicit quit, and background startup.
- Add background/start-at-login settings and platform implementations.

Acceptance:

- Closing the window leaves the tray process alive.
- Opening the app again focuses the existing instance.
- Explicit tray Quit cleanly terminates child processes and the database.
- Background login starts without flashing a workspace window.

### Phase 1 — Contracts, schema, and scheduler core

- Add automation contracts and validators.
- Add definitions, runs, events, and settings repositories.
- Add time-zone-aware schedule calculation.
- Implement serialized reconciliation and `coalesce-one` logic.
- Add startup, timer, resume, and clock-change triggers.

Acceptance:

- Five missed daily occurrences produce exactly one catch-up run.
- Repeated reconciliation is idempotent.
- DST transitions and clock rollback do not duplicate a slot.
- Disabled schedules do not catch up when re-enabled.

### Phase 2 — Connectivity, queue, and recovery

- Add connectivity monitor and network-required policy.
- Add persistent queue, cancellation, timeout, concurrency, and graceful shutdown.
- Recover queued/waiting jobs; mark active old jobs interrupted.
- Add log/event caps and cleanup.

Acceptance:

- Staying offline for several due times creates one pending marker.
- Reconnection creates one run and clears the marker atomically.
- Restarting repeatedly while offline does not duplicate runs.
- An interrupted active run is not silently executed again.

### Phase 3 — Codex executor

- Add capability detection and non-interactive invocation.
- Parse `--json` JSONL events.
- Map permission profiles to explicit Codex policies.
- Add account/auth preflight and actionable failures.
- Integrate managed worktrees and result summaries.

Acceptance:

- Read-only and workspace-write jobs run without a visible terminal.
- Missing/outdated CLI and missing auth fail before task execution.
- Cancel and timeout terminate the process tree.
- A successful editing job exposes its worktree diff for review.

### Phase 4 — Sidebar UI

- Add the Automations rail icon above Music.
- Add panel, cards, form, filters, badges, detail/history, pause, and Run now.
- Add renderer bootstrap/reconnect behavior.
- Connect notification clicks and tray navigation.

Acceptance:

- Definitions survive restart.
- UI status matches main-process state after window recreation.
- Keyboard navigation, focus, labels, and reduced-motion states work.
- Narrow/wide workspace layouts remain backward compatible.

### Phase 5 — Additional providers

- Verify and implement provider adapters one by one.
- Expose only capabilities actually supported by the installed CLI version.
- Add provider-specific tests and authentication handling.

### Phase 6 — Hardening and release

- Run full typecheck, tests, production build, and packaged smoke tests.
- Test macOS, Windows, and supported Linux background startup/tray behavior.
- Test sleep/wake, reboot/login, offline/online, DST, clock changes, and crash recovery.
- Add retention/cleanup controls and documentation.

## 16. Test plan

### Unit tests

- Schedule parsing and next/latest occurrence calculations.
- DST forward/backward transitions with IANA zones.
- Coalescing many missed occurrences into one marker.
- Idempotent reconcile and unique slot keys.
- Definition validation and dangerous-mode gate.
- Run-state transitions and interrupted recovery.
- Connectivity failure classification and retry budget.
- Executor argument construction without shell interpolation.
- JSONL parsing, malformed line handling, and output caps.
- Redaction of tokens, paths, and credentials.

### Integration tests

- SQL migration from the current database without automation tables.
- Create/update/disable/delete lifecycle.
- Offline due event followed by restart and reconnect.
- Active-run overlap followed by one coalesced run.
- Worktree create, retain, review, and cleanup.
- Renderer unsubscribe/reconnect with a main-process job still running.
- Notification/tray aggregate state.

### Packaged smoke tests

- Close button hides to tray on Windows/macOS/Linux.
- Login startup creates no duplicate instance.
- Background-start scheduler works without a `BrowserWindow`.
- Explicit Quit does not relaunch the app.
- OS shutdown marks jobs safely and does not corrupt `workspace.db`.

## 17. Edge-case decisions

| Situation | Required behavior |
| --- | --- |
| App closed for multiple schedule times | One catch-up run at next service start |
| Computer sleeps through multiple times | One catch-up run after resume |
| Offline through multiple times | One pending marker; one run after connectivity returns |
| Due while same automation is active | Replace one pending marker with latest slot |
| App restarts repeatedly while offline | No duplicate run rows |
| Clock moves backward | Unique slot key prevents duplicate occurrence |
| Time zone changes | Recalculate future time; do not backfill the disabled/old zone |
| Automation disabled | Clear pending catch-up; no accumulation |
| One-time schedule missed | Run once on recovery, then disable |
| Project folder missing | `needs-attention`; do not run elsewhere |
| CLI missing or auth expired | `needs-attention` with notification |
| Main process crashed mid-run | Mark interrupted; retain worktree; do not auto-replay |
| Internet drops mid-run | Retry same run within budget after recovery |
| Full access selected | Require explicit confirmation and show exact scope |

## 18. Definition of done

The feature is complete only when:

- the automation icon appears immediately above Music;
- the tray/menu-bar icon keeps the main process alive after window close;
- start-at-login/background-start works in packaged builds;
- schedule data and history survive restart;
- missed times coalesce into exactly one catch-up opportunity;
- offline recovery does not create backlog or duplicates;
- system sleep/wake and clock changes are reconciled;
- Codex runs through its non-interactive structured interface;
- job permissions are explicit and least-privilege by default;
- editing jobs use managed worktrees by default;
- full access is an explicit dangerous-mode choice;
- active processes can be cancelled and are cleaned up on quit;
- failures and attention states are visible in sidebar, tray, history, and notifications;
- migrations are non-destructive;
- security-gate items are completed;
- unit, integration, typecheck, build, and packaged smoke tests pass.

## 19. Recommended first implementation slice

Implement Phase 0 and the scheduler data foundation together, but keep actual CLI execution behind a disabled feature flag until the security gate is complete.

The first reviewable vertical slice should demonstrate:

1. Automations icon above Music.
2. Create/edit a daily schedule persisted in dedicated tables.
3. Tray/background lifecycle and start-at-login setting.
4. Simulated runner proving startup, sleep, and offline coalescing.
5. Tests showing several missed slots become one catch-up run.

After that foundation passes, enable the real Codex executor as the next slice.
