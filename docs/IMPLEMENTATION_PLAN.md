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
| Browser automation (managed Edge profile, refs, tabs, forms, verification) | ✅ | `control/browserService.ts`; Chrome fallback; downloads blocked; personal profile isolated |
| Browser downloads with approval | 🔧 | Downloads are currently hard-blocked (`acceptDownloads: false`); an approval-gated path is a possible later add |
| CAPTCHA/MFA human handoff | 🔧 | Blocklist + "stop and explain" prompt rules; no dedicated handoff UX yet |
| Voice: push-to-talk STT | ✅ | Mic capture in `ChatPage` → `voice.transcribe` (Gemini inline audio) |
| Voice: TTS replies, VAD, interruptible speech, hands-free continuous mode | ✅ | `src/shared/speech.ts`, `ChatPage.tsx`, Settings → Voice; wake word deferred (see Phase 5) |
| Voice: wake word ("Hey IGRIS") | ⏸ | Deferred: Web Speech needs Google's backend (fails `network`), Gemini per-window STT burns free quota, local engines need a vendor AccessKey |
| Memory store (SQLite, kinds, search, inspect/edit/delete, model recall) | ✅ | `MemoryRepository`, save/search memory tools, prompt block (explicit-save only) |
| Memory: duplicate detection | ✅ | `findSimilarMemory` (normalize + Jaccard 0.8) gates `save_memory`; near-copies refused with the original id |
| Coding assistant (scan, tree, read/search/write/patch, rename/delete, checkpoints, run command, run tests, git via terminal) | ✅ | `fileService`, `terminalService`, `registry.ts`, workspace permission gates |
| Agent orchestration: executor loop, step tracking, limits | ✅ | `chatEngine` loop + `taskService` step records; bounded by turns/actions/time |
| Agent orchestration: Planner / Verifier / Recovery | 🔧 | Planner: persisted `plan_task` artifact; Verifier: evidence-based pass with persisted verdict; Recovery: plan-aware retries. Remaining: task-level pause/resume mid-run |
| Agent orchestration: Task Manager (pause, resume, cancel, retry, SQLite persistence) | 🔧 | Cancel/retry/persisted state shipped; mid-run task pause/resume remaining (control sessions already pause/resume) |
| SQLite persistence (conversations, tasks, providers, memories, logs) | ✅ | `storage/database.ts`, `repositories.ts` |
| DPAPI-protected keys, redaction, path guard, command policy | ✅ | `security/*` |
| IPC allowlist validation | ✅ | `ipc.ts` + `shared/ipc.ts` contract |
| Packaging (NSIS installer, packaged smoke test) | ✅ | `electron-builder.yml`, `npm run test:packaged`, `npm run dist` |
| UI: dark/ice-blue terminal workspace, 3D core, companion, task monitor | ✅ | `ChatPage`, `IgrisCore`, `RobotCompanion`, `ToolTimeline`, `ActivityPage` |
| UI polish pass (hover/animation audit, dead-control sweep) | 🔧 | Phase 9 |
| Docs (README, ARCHITECTURE, SECURITY, TESTING, STATUS) | ✅ | `docs/*` |

### Known reliability findings from live use (fixed in Phase 2 so far)

1. Gemini 3 `thoughtSignature` must be echoed after tool calls — fixed + tested.
2. Exhausted daily quota surfaces as `QUOTA` with reset guidance — fixed + tested.
3. Transient provider failures retry with backoff — fixed + tested.
4. A single flaky provider no longer fails a whole run — fixed via fallback (this phase).
5. `gemini-3.6-flash` can hang instead of erroring; the 3-minute turn timeout catches it and fallback now reroutes the turn to the next provider.

## Phase 2 — Fix existing functionality and reliability

✅ Core slice complete (see audit table). Remaining: watchdog for hung provider
requests is the 3-minute timeout (shipped); optional download-with-approval flow
(⬜, later phase).

## Phase 3 — Secure Windows desktop control

✅ Shipped earlier (`7b2e52b`, `24c2542`). Verified with unit tests, E2E HUD
tests, packaged smoke, and live runs. Remaining enhancement: per-action
screenshot diffing for verifier evidence (Phase 6).

## Phase 4 — Browser automation

✅ Shipped. Live-verified including full YouTube playback (Nov 2026).

## Phase 5 — Voice assistant

🔧 Core slice complete. Shipped: TTS replies via `speechSynthesis` (Windows
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

🔧 Core slice complete. Shipped:

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

Remaining for full Phase 6: task-level pause/resume mid-run (control sessions
already support pause/resume; the chat executor currently supports
cancel/retry only).

Files: `shared/types.ts`, `shared/defaults.ts`, `storage/database.ts` (v2),
`storage/repositories.ts`, `tasks/taskService.ts`, `tools/registry.ts`
(`plan_task`), `ai/chatEngine.ts` (planner block, verifier, recovery),
`SettingsPage.tsx`, `ActivityPage.tsx`, `styles.css`; tests
`tests/unit/taskVerification.test.ts`, `tests/unit/planTool.test.ts`,
`tests/integration/database.test.ts`.

## Phase 7 — Persistent memory

🔧 Core slice complete. Shipped: duplicate detection on save — `findSimilarMemory`
in `src/shared/similar.ts` normalizes text and applies a Jaccard token-overlap
threshold (0.8); the `save_memory` tool refuses near-duplicates and reports the
existing memory id instead of adding a near-copy. Tested in
`tests/unit/memoryDedupe.test.ts`.

Remaining: memory inspection/editing currently lives in Settings → Memory
(existing UI); no additional gaps identified beyond the earlier audit —
recall, search, inspect/edit/delete, and the 200-item cap were already shipped.

Files: `src/shared/similar.ts` (new), `tools/registry.ts` (`save_memory` gate).

## Phase 8 — Coding assistant

🔧 Mostly shipped. Remaining: automatic checkpoint creation before multi-file
patches (currently model-invoked); diff review UX already exists in `ToolTimeline`/`diff.ts`.

## Phase 9 — UI polish

⬜ Current. Sweep every visible control for dead buttons; add hover/focus states;
ensure HUD states (idle/listening/thinking/executing/error) map to real engine state.

## Phase 10 — Security audit, integration testing, packaging

⬜ Final pass: re-run full audit of permissions/IPC, refresh `SECURITY.md`,
rebuild installer + checksum, update all docs.

## Acceptance criteria tracking

See the master requirement list in the project brief; each bullet maps to a row
above. Nothing is claimed complete without the test command that proves it.
