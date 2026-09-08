# Bikorch — Product Roadmap

**Decision date:** 2026-09-07  
**Status:** Approved product requirements; implementation not yet completed  
**Repository:** Birkanatmaca/bikorch  
**Audience:** Product owner and AI coding agents

## 1. Product direction

Bikorch is a cross-platform desktop workspace for developers who use multiple AI coding CLIs. Its core value is managing projects, terminals, agents, context, tasks and Git in one customizable environment. It is not intended to replace a full IDE.

Two additional product modules are now approved and must be retained in the roadmap:

1. **Developer Intelligence / Profile / Memory** — usage analytics, AI accounts and spending, developer behavior insights, prompt history and a user-controlled memory engine.
2. **Music / Focus Player** — a local music library, personal playlists, a sidebar mini player, YouTube search (stream in-app or download into the library), favorites and listening history.

Both are definite product requirements, not claims that their functionality is already implemented. The developer module has priority; Music is a complementary productivity feature. Do not rewrite the existing workspace or abandon its core purpose to implement either module.

## 2. Existing architecture and integration points

Inspect the current repository before making changes. As reviewed on the decision date, the application uses Electron, React, TypeScript, Vite, Zustand, xterm.js, a node-pty implementation and sql.js. Existing functionality includes project workspaces, CLI sessions, Git/diff, tasks, accounts, usage, logs and web chat panels.

Relevant integration points:

- `src/main/index.ts` — Electron window initialization and main-process lifecycle.
- `src/main/ipc/index.ts` — IPC handler registration.
- `src/preload/index.ts` — typed, restricted renderer API.
- `src/shared/contracts/` — IPC request/response contracts.
- `src/main/persistence/database.ts` — existing local persistence.
- `src/main/cli/pty-manager.ts` and `src/main/cli/adapters.ts` — CLI sessions and provider launch logic.
- `src/renderer/components/terminal/TerminalView.tsx` — terminal presentation and input handling.
- `src/renderer/stores/workspace-store.ts` — projects, panels and layout state.
- `src/renderer/components/layout/SidebarActivityBar.tsx` and `LeftSidebar.tsx` — sidebar navigation and content.
- `src/renderer/components/layout/WorkspaceLayout.tsx` — workspace composition.
- `src/shared/types/index.ts` — panel and workspace types.
- `src/shared/contracts/usage.ts` and `src/renderer/stores/usage-store.ts` — existing provider usage data.
- `src/main/accounts/` — existing CLI account and credential handling.

Read the actual implementations before choosing extensions. Preserve existing project data, account identities, terminal behavior and panel layouts.

## 3. Implementation principles

- Build small, reviewable vertical slices.
- Keep privileged operations in the Electron main process.
- Expose narrowly scoped, validated IPC contracts through preload.
- Keep UI state separate from persistent domain data and external provider adapters.
- Use real data or explicit empty/unavailable/estimated states.
- Never display fabricated usage, credits, costs, language percentages or subscription dates as actual values.
- Preserve user control over data capture, external AI requests, credential use and destructive actions.
- Do not collect private prompt content or send it to an analysis API without clear informed opt-in.
- Do not bypass third-party subscriptions, advertisements, DRM, download restrictions or access controls.
- Run available typechecks, builds and relevant tests for each slice.
- Do not silently migrate or delete existing user data.
- A completed implementation requires functioning UI, main-process services, persistence, error handling and acceptance-test evidence.

## 4. Priority roadmap

| Phase | Priority | Deliverable |
| --- | --- | --- |
| 0 | P0 | Baseline audit, security and data-migration design |
| 1 | P0 | Profile shell, prompt/event history, privacy controls |
| 2 | P0 | Usage and cost dashboard, AI account subscriptions |
| 3 | P0 | Developer metrics, insights and memory engine |
| 4 | P1 | Context sharing and user-controlled agent handoff |
| 5 | P1 | Local Music library and sidebar player |
| 6 | P1 | Music playlists, imports, offline playback and focus integration |
| 7 | P2 | YouTube search, in-app playback and library downloads |
| 8 | P2 | Advanced insights and richer workflows |

Priorities are product priorities, not delivery dates.

## 5. Developer Intelligence — approved scope

See [`2026-09-07_DEVELOPER_INTELLIGENCE.md`](./2026-09-07_DEVELOPER_INTELLIGENCE.md).

Required areas:

- Overview
- Developer Insights
- AI Accounts
- Usage & Costs
- Memory
- Privacy controls
- Global and project-scoped context
- Evidence-backed developer preferences
- Prompt history and activity analytics

Important measurement rule: a CLI terminal is not automatically an API usage meter. Do not infer exact token counts or billing amounts from terminal text lengths. Use official provider data or structured events where available; otherwise label estimates or unavailable data.

Language percentages must describe what they measure. Prompt mentions alone are insufficient evidence of actual language usage.

## 6. Music / Focus Player — approved scope

See [`2026-09-07_MUSIC_FOCUS_PLAYER.md`](./2026-09-07_MUSIC_FOCUS_PLAYER.md).

Required areas:

- Music icon in the existing sidebar
- Compact mini player
- Local music import and offline playback
- My Music
- Downloads
- Favorites
- Playlists
- Recently Played
- Queue
- YouTube search, in-app playback and downloads
- YouTube playback integration
- Optional Focus Mode integration

YouTube audio download into the local library is in scope when the user starts it. Do not add Spotify. Do not circumvent DRM or strip ads on other services.

## 7. Shared product design

Use the existing Bikorch dark developer-tool aesthetic. Profile and Music must look native to the existing application.

The sidebar remains the main navigation surface.

Profile can use a wide dashboard layout. Music should support both a compact sidebar player and an expanded library.

## 8. Shared data and security foundations

Profile and Music are separate bounded domains. They may share settings, persistence migrations, secure credential storage, typed IPC and error handling.

Do not store raw prompts in generic logs, telemetry, renderer localStorage or crash reports.

Music files remain local by default.

Before adding external API credentials or embedded players, review Electron security, webview permissions, URL validation, IPC authorization and credential handling.

## 9. Agent execution contract

When handed this roadmap, the coding agent should:

1. Inspect the current repository first.
2. Compare requirements against existing code.
3. Produce an implementation checklist before large code changes.
4. Implement one vertical slice at a time.
5. Include migrations, security, tests and error states in each slice.
6. Run typecheck/build/tests after each meaningful milestone.
7. Never claim a provider integration works when only mocked.
8. Keep approved requirements separate from completed work.

**Recommended first task:** implement the Profile shell plus an opt-in prompt/event history foundation using existing accounts and usage infrastructure.

For Music, start with real local audio import, a persistent library and a functioning mini player before streaming integrations.

## 10. Definition of done

A module is not complete because its UI exists.

Done means:

- real data survives restart
- primary workflows work
- unavailable integrations fail gracefully
- permissions are scoped
- critical logic is tested
- the application still builds
- limitations are documented
