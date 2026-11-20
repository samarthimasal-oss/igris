# IGRIS 2.0 Implementation Plan

Status legend: ✅ shipped and verified · 🔧 partially shipped (gaps listed) · ⬜ not started · ⏸ deferred with rationale.

This plan maps the IGRIS 2.0 requirements onto the existing codebase. It is the
working contract for the upgrade: phases are implemented in order, each with
tests and documentation, and no phase is marked complete until its tests pass.

## Phase 1 — Repository audit and architecture documentation

✅ Complete (this document plus `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
`docs/TESTING.md`, `docs/STATUS.md`, `CHANGELOG.md`).

### Audit results by requirement area

| Area | State | Notes |
| --- | --- | --- |
| Electron + React + TypeScript + R3F shell | ✅ | `src/main/index.ts`, `src/renderer/*`; main window, mini launcher, HUD, tray |
| Provider abstraction (OpenAI, Anthropic, Gemini, OpenRouter, OpenCode gateway) | ✅ | `src/main/ai/providers/*`, `providerService.ts`; free-model guards for OpenRouter/OpenCode |
| In-request transient retry (503/429/network, backoff, no duplicate output) | ✅ | `chatEngine.streamTurn` + `tests/unit/chatRetry.test.ts` |
| Automatic provider/model fallback | ✅ | `providerService.fallbackChain`, `chatEngine.streamTurnWithFallback`, `ai.autoFallback` setting, `tests/unit/chatFallback.test.ts` |
| Task-complexity model routing | ⬜ | Deferred: subjective routing risks silent model downgrades; revisit after fallback proves out |
| Windows computer control (C# helper, SendInput/UIA, screenshots, windows, apps) | ✅ | `resources/operator/*` C# operator, `operatorClient.ts`, `desktopService.ts`, `control/policy.ts` |
| Task-scoped approval, 20-min expiry, HUD, Pause/Resume, `Ctrl+Alt+Shift+X` stop | ✅ | `control/sessionService.ts`, `controlHud.ts`, `index.ts` |
| Hard blocks (passwords, UAC, credential managers, own windows) + confirmations | ✅ | `control/policy.ts`, `desktopService.ts`, `registry.ts` gates |
| Three tools: `request_computer_control`, `desktop`, `browser` | ✅ | `tools/registry.ts` |
| Browser automation (managed Edge profile, refs, tabs, forms, verification) | ✅ | `control/browserService.ts`; Chrome fallback; approval-gated downloads; personal profile isolated |
| Browser downloads with approval | ✅ | Save dialog per file, active-session check, blocked executable/script types, 200 MB cap, no auto-open; results reported in `browser` state |
| CAPTCHA/MFA human handoff | ✅ | `browser` action `handoff` with a reason pauses the control session and holds the run until the user resumes; Stop, expiry, cancel, and shutdown end the wait |
| Voice: push-to-talk STT | ✅ | Mic capture in `ChatPage` → `voice.transcribe` (Gemini inline audio) |
| Voice: TTS replies, VAD, interruptible speech, hands-free continuous mode | ✅ | `src/shared/speech.ts`, `ChatPage.tsx`, Settings → Voice; wake word deferred (see Phase 5) |
| Voice: wake word ("Hey IGRIS") | ⏸ | Deferred: Web Speech needs Google's backend (fails `network`), Gemini per-window STT burns free quota, local engines need a vendor AccessKey |
| Memory store (SQLite, kinds, search, inspect/edit/delete, model recall) | ✅ | `MemoryRepository`, save/search memory tools, prompt block (explicit-save only) |
| Memory: duplicate detection | ✅ | `findSimilarMemory` (normalize + Jaccard 0.8) gates `save_memory`; near-copies refused with the original id |
| Coding assistant (scan, tree, read/search/write/patch, rename/delete, checkpoints, run command, run tests, git via terminal) | ✅ | `fileService`, `terminalService`, `registry.ts`, workspace permission gates |
| Coding assistant: automatic checkpoints | ✅ | write/patch auto-backup + rename auto-checkpoint + Recycle-Bin delete; grouped checkpoints model-invoked |
| Agent orchestration: executor loop, step tracking, limits | ✅ | `chatEngine` loop + `taskService` step records; bounded by turns/actions/time |
| Agent orchestration: Planner / Verifier / Recovery | ✅ | Planner: persisted `plan_task` artifact; Verifier: evidence-based pass with persisted verdict; Recovery: plan-aware retries |
| Agent orchestration: Task Manager (pause, resume, cancel, retry, SQLite persistence) | ✅ | Cancel/retry/persisted state plus checkpoint-level pause/resume mid-run (`chatEngine.pauseTask/resumeTask`, `paused` status); control sessions pause/resume independently |
| SQLite persistence (conversations, tasks, providers, memories, logs) | ✅ | `storage/database.ts`, `repositories.ts` |
| DPAPI-protected keys, redaction, path guard, command policy | ✅ | `security/*` |
| IPC allowlist validation | ✅ | `ipc.ts` + `shared/ipc.ts` contract |
| Packaging (NSIS installer, packaged smoke test) | ✅ | `electron-builder.yml`, `npm run test:packaged`, `npm run dist` |
| UI: dark/ice-blue terminal workspace, 3D core, companion, task monitor | ✅ | `ChatPage`, `IgrisCore`, `RobotCompanion`, `ToolTimeline`, `ActivityPage` |
| UI polish pass (hover/animation audit, dead-control sweep) | ✅ | All handlers wired; hover + global `:focus-visible`; HUD state mapping E2E-verified; Phase 9/10 E2E check added (10 passing) |
| Docs (README, ARCHITECTURE, SECURITY, TESTING, STATUS) | ✅ | `docs/*` |

### Known reliability findings from live use (fixed in Phase 2 so far)

1. Gemini 3 `thoughtSignature` must be echoed after tool calls — fixed + tested.
2. Exhausted daily quota surfaces as `QUOTA` with reset guidance — fixed + tested.
3. Transient provider failures retry with backoff — fixed + tested.
4. A single flaky provider no longer fails a whole run — fixed via fallback (this phase).
5. `gemini-3.6-flash` can hang instead of erroring; the 3-minute turn timeout catches it and fallback now reroutes the turn to the next provider.

## Phase 2 — Fix existing functionality and reliability

✅ Core slice complete (see audit table). The 3-minute turn timeout is the
hung-request watchdog (shipped); approval-gated browser downloads shipped with
browser control.

## Phase 3 — Secure Windows desktop control

✅ Shipped earlier (`7b2e52b`, `24c2542`). Verified with unit tests, E2E HUD
tests, packaged smoke, and live runs. Optional later enhancement: per-action
screenshot diffing for verifier evidence.

## Phase 4 — Browser automation

✅ Shipped. Live-verified including full YouTube playback (Nov 2026).

## Phase 5 — Voice assistant

✅ Core slice complete. Shipped: TTS replies via `speechSynthesis` (Windows
voices, no paid API) with voice settings (enabled, voice, rate) in Settings →
Voice; spoken text is prose-only via `speechScript` (code/tables/markdown
stripped, tested); speech is interrupted when the user talks, sends, or stops;
hands-free continuous listening (explicit toggle) re-arms the mic between turns
with a voice-activity gate so silent recordings are never transcribed;
verified live: `speechSynthesis.speaking` with Microsoft David/Mark/Zira, the
audio graph runs without a user gesture, real mic RMS gates work.

Deferred: **wake word ("Hey IGRIS")**. The Chromium SpeechRecognition API in
this Electron build fails with `error:network` (no Google speech backend), a
per-window Gemini transcription loop would burn the free daily quota, and a
local engine (Porcupine) needs a vendor AccessKey. Push-to-talk + hands-free is
the supported path; revisit if a local engine becomes acceptable.

Files: `src/shared/speech.ts` (new), `ChatPage.tsx`, `SettingsPage.tsx`,
`store.ts`, `shared/types.ts` + `defaults.ts`; tests
`tests/unit/speech.test.ts`.

## Phase 6 — Agent orchestration

✅ Core slice complete. Shipped:

1. Planner artifact: the `plan_task` tool records ordered steps (1–12) and
   risks on the task row (`tasks.plan` JSON column, schema migration v2);
   system-prompt rules tell the model to call it before multi-action work;
   steps render in Task Monitor.
2. Verifier: after any task that used consequential tools, one bounded model
   call (`verifyOutcome`) receives the objective + recorded tool results and
   must return JSON `{status: verified|failed|unverified, evidence, steps[]}`.
   `failed` fails the task (never a silent false success); verifier errors or
   unparsable replies persist `unverified`; verdict + evidence persist on the
   task and render in Task Monitor; per-step verdicts merge into the plan.
   Settings → AI → "Verify consequential actions" (default on).
3. Recovery: retrying a failed task builds a recovery prompt from the
   persisted plan progress (statuses + evidence) and the verifier finding, so
   the executor resumes from the first unfinished step instead of restarting.
4. Task-level pause/resume: a pause request blocks the executor at its next
   checkpoint (between model turns and between tool calls, never mid-action),
   persists the task as `paused` (schema transition `running ↔ paused`,
   `paused → failed/cancelled`), and resume/cancel/shutdown all release it.
   Task Monitor and the chat composer expose Pause/Resume; interrupted paused
   tasks are reaped as failed on startup. Tests: `tests/unit/taskPause.test.ts`.

Phase 6 is complete.

Files: `shared/types.ts`, `shared/defaults.ts`, `storage/database.ts` (v2),
`storage/repositories.ts`, `tasks/taskService.ts`, `tasks/state.ts`,
`tools/registry.ts` (`plan_task`), `ai/chatEngine.ts` (planner block, verifier,
recovery, pause gate), `ipc.ts`, `preload/index.ts`, `SettingsPage.tsx`,
`ActivityPage.tsx`, `ChatPage.tsx`, `styles.css`; tests
`tests/unit/taskVerification.test.ts`, `tests/unit/planTool.test.ts`,
`tests/unit/taskPause.test.ts`, `tests/integration/database.test.ts`.

## Phase 7 — Persistent memory

✅ Core slice complete. Shipped: duplicate detection on save — `findSimilarMemory`
in `src/shared/similar.ts` normalizes text and applies a Jaccard token-overlap
threshold (0.8); the `save_memory` tool refuses near-duplicates and reports the
existing memory id instead of adding a near-copy. Tested in
`tests/unit/memoryDedupe.test.ts`.

Remaining: memory inspection/editing currently lives in Settings → Memory
(existing UI); no additional gaps identified beyond the earlier audit —
recall, search, inspect/edit/delete, and the 200-item cap were already shipped.

Files: `src/shared/similar.ts` (new), `tools/registry.ts` (`save_memory` gate).

## Phase 8 — Coding assistant

✅ Complete for the audited gaps. Findings during this pass:

- `write_file` and `apply_patch` **already auto-backup** the previous version
  (`files.write` returns `backupPath`), so the "automatic checkpoint before
  patches" gap was narrower than the Phase 1 audit assumed.
- Added: `rename_entry` now creates an automatic checkpoint of the source file
  before the move (the only destructive-path operation without a backup);
  directories are skipped gracefully. `delete_entry` moves to the Recycle Bin
  and is reversible. Grouped multi-file checkpoints remain model-invoked via
  `create_checkpoint`.
- Verification of edits is now enforced by the Phase 6 verifier pass
  (file-write tools are in the consequential set).

Files: `tools/registry.ts` (`rename_entry`); test
`tests/unit/renameCheckpoint.test.ts`.

## Phase 9 — UI polish

✅ Complete. Findings and fixes from the dead-control sweep:

- Static sweep of every `onClick` across all pages, HUD, mini-launcher, and
  overlays: every control touches real state, IPC, or navigation; no no-op
  handlers, no TODO/placeholder markers, no `</button>` without a handler
  (Button/IconButton receive handlers via prop spread; TerminalInput uses
  `onMouseDown`).
- Hover states exist for all button variants, tabs, nav items, and tool cards;
  `:focus-visible` is globally styled; disabled/loading variants covered.
- HUD verified to map to real engine state: it renders `control.state()` and
  live `onControl` events (status, scope, goal, elapsed, action budget) and is
  E2E-verified to pause/resume/stop.
- All terminal slash commands (`/help /status /projects /tools /history
  /memory /settings /clear`) are handled locally with real data.
- Added E2E coverage that the Phase 5/6 settings controls render and are
  wired (fallback + verifier toggles, hands-free listening) — 10/10 passing.

## Phase 10 — Security audit, integration testing, packaging

✅ Complete:

- Re-ran the IPC/security audit: single-call-channel dispatcher with a
  per-window role allowlist, Zod validation per method, unknown-method
  rejection; `contextIsolation`/`sandbox`/`nodeIntegration:false` on all three
  windows; CSP + nosniff in production; navigation and window-open guards on
  every window; `openExternal` restricted to HTTP(S) without embedded
  credentials. New slices re-checked: the verifier call carries no tools and
  sees only truncated recorded results; fallback only retries the user's own
  configured providers; memory dedupe is fully local; rename checkpoints stay
  inside the validated backup root. `SECURITY.md` gained a
  "Verification, fallback, and new slices" section.
- Installer rebuilt over all IGRIS 2.0 slices; packaged smoke passes
  (`npm run test:packaged`); fresh SHA-256 recorded in `docs/STATUS.md`.

## Acceptance criteria tracking

See the master requirement list in the project brief; each bullet maps to a row
above. Nothing is claimed complete without the test command that proves it.
