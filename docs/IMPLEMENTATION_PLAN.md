# IGRIS 2.0 Implementation Plan

Status legend: ✅ shipped and verified · 🔧 partially shipped (gaps listed) · ⬜ not started.

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
| Voice: wake word ("Hey IGRIS"), TTS replies, VAD, interruptible speech, continuous mode | ⬜ | Phase 5 |
| Memory store (SQLite, kinds, search, inspect/edit/delete, model recall) | ✅ | `MemoryRepository`, save/search memory tools, prompt block (explicit-save only) |
| Memory: duplicate detection | ⬜ | Phase 7 |
| Coding assistant (scan, tree, read/search/write/patch, rename/delete, checkpoints, run command, run tests, git via terminal) | ✅ | `fileService`, `terminalService`, `registry.ts`, workspace permission gates |
| Agent orchestration: executor loop, step tracking, limits | ✅ | `chatEngine` loop + `taskService` step records; bounded by turns/actions/time |
| Agent orchestration: dedicated Planner / Verifier / Recovery modules | 🔧 | Planner is prompt-driven; verification is prompt-rule-based; recovery = in-request retry + provider fallback + manual task retry. Dedicated verifier evidence pass is Phase 6 |
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

⬜ Current. Plan:

1. TTS replies via `speechSynthesis` in the renderer (Windows voices, no paid API), with a voice settings section (enabled, voice, rate).
2. Interruptible speech: speaking stops when the user starts talking or presses Stop.
3. Wake word: a small local keyword listener using continuous `getUserMedia` + provider transcription of short rolling windows is possible but costly in API calls; the honest local alternative is Web Speech `SpeechRecognition` where the Chromium build supports it, otherwise wake-word ships as a manual mic toggle. Decide after a capability probe in the running app.
4. Files: `voiceService.ts` (TTS orchestration), `ChatPage.tsx` (mic + speaker state), `SettingsPage.tsx` (voice settings), `shared/types.ts` (settings).

## Phase 6 — Agent orchestration

⬜ Current. Plan:

1. Extract the executor loop's planning prompt into a structured plan artifact persisted on the task row (steps with status).
2. Add a verifier step: after control/tool actions flagged as consequential, require a fresh observation (screenshot, element state, file read) before the run may declare success; the model must cite the evidence.
3. Recovery: on replan, mark completed steps and resume from the failed step instead of restarting the task.
4. Files: `chatEngine.ts`, `taskService.ts`, `shared/types.ts`, `ToolTimeline.tsx`.

## Phase 7 — Persistent memory

⬜ Current gaps: duplicate detection on save; memory UI is a settings page list.
Plan: normalize + fuzzy-dedupe on save (exact + token-overlap check), show
duplicate warning in the save tool result. Files: `MemoryRepository`, `registry.ts`.

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
