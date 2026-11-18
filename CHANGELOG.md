# Changelog

All notable changes to IGRIS are documented here. Versions follow the app
version in `package.json` / `electron-builder.yml`.

## [1.0.0] — IGRIS 2.0 upgrade track (in progress)

Work happens on `feature/desktop-control`; each entry below is a shipped,
tested slice. See `docs/IMPLEMENTATION_PLAN.md` for the full phase plan and
`docs/STATUS.md` for verification details.

### Added

- **Automatic provider fallback (Phase 2 slice).** When the default provider
  keeps failing before anything was delivered, the turn is retried on the next
  configured provider with a stored key and model (`providers.fallbackChain` +
  `chatEngine.streamTurnWithFallback`). Covers auth failures, rate limits,
  quotas, network errors, timeouts, and generic provider errors; never switches
  after output was delivered; honours the new **Automatic provider fallback**
  toggle in Settings → AI (default on); restores the original provider and
  rethrows the original error when the chain is exhausted. Tested in
  `tests/unit/chatFallback.test.ts` (5 tests).
- **Voice output and hands-free mode (Phase 5 slice).** Replies are spoken
  aloud with Windows `speechSynthesis` voices (Settings → Voice: enabled,
  voice, rate; default off). Spoken text is reduced to prose — code blocks,
  tables, and markdown are stripped (`src/shared/speech.ts`) — and speech is
  interrupted when you start talking, send a message, or press Stop. Hands-free
  listening re-arms the microphone between turns when explicitly enabled, with
  a voice-activity gate so silent recordings are never transcribed. Wake word
  ("Hey IGRIS") is deferred with rationale in `docs/STATUS.md`.
- **Agent orchestration slice (Phase 6).** Multi-action tasks record a plan via
  `plan_task` (persisted on the task row, rendered in Task Monitor). Tasks that
  used consequential tools get a bounded verifier pass that judges only the
  recorded tool evidence; its verdict (`verified`/`failed`/`unverified`) is
  persisted, shown in Task Monitor, merged per step into the plan, and a
  `failed` verdict fails the task instead of reporting success. Retrying a
  failed task resumes from plan progress and the verifier finding. Toggle:
  Settings → AI → "Verify consequential actions" (default on).
- **Memory duplicate detection (Phase 7 slice).** `save_memory` normalizes text
  and compares token overlap against the existing store (`src/shared/similar.ts`);
  a duplicate is refused with the original memory id reported instead of adding
  a near-copy.
- **Rename checkpoint (Phase 8 slice).** `rename_entry` checkpoints the source
  file before moving it; writes and patches already auto-backup, and deletes go
  to the Recycle Bin.
- **UI dead-control sweep (Phase 9 slice).** Every visible control verified
  wired to real state/IPC/navigation; hover and `:focus-visible` coverage
  confirmed; HUD state mapping E2E-verified; new E2E check covers the Phase 5/6
  settings controls (10 Electron smoke tests passing).
- **Task pause/resume mid-run.** Running tasks can be paused from the Task
  Monitor or the chat composer; the executor blocks at its next checkpoint
  (between turns and between tool calls), the task persists as `paused`, and
  resume/cancel/shutdown all release it cleanly. Completes the Task Manager
  requirement (`tests/unit/taskPause.test.ts`).
- **CAPTCHA/MFA handoff.** When a page needs a CAPTCHA, one-time code, MFA
  approval, or sign-in, the model calls `browser` with action `handoff` instead
  of guessing. The control session pauses, the run waits (with its clock
  paused) until the user presses Resume, and then the model re-observes the
  page. Stop, expiry, cancel, and shutdown all end the wait. No new
  permissions (`tests/unit/browserHandoff.test.ts`).
- **Final security audit + rebuild (Phase 10).** Permissions/IPC re-audit
  clean for all new slices (verifier has no tools; fallback only retries the
  user's own providers; dedupe is local; rename checkpoints stay in the backup
  root); SECURITY.md refreshed; installer rebuilt and the SHA-256 in
  `docs/STATUS.md` updated; packaged smoke passes.
- In-turn transient retry: up to two extra attempts with 2s/6s backoff for
  retryable provider errors (503 high-demand, brief rate limits, network
  drops), only before any output was streamed.
- Task-scoped Windows desktop and browser control: C# operator (SendInput /
  UIA / screenshots / window and app management), managed browser profile,
  approval HUD with Pause/Resume and 20-minute expiry, global stop hotkey,
  hard blocks for password fields, UAC, credential managers, and IGRIS's own
  windows.
- Coding assistant tools: project scan, tree, read/search/write/patch,
  rename/move, delete, checkpoints, allowlisted terminal commands, test runs.
- Memory store (SQLite): explicit save/search/inspect/edit/delete with model
  recall; duplicate detection is planned (Phase 7).
- Voice input: push-to-talk microphone capture transcribed via Gemini inline
  audio.

### Fixed

- Gemini 3 `thoughtSignature` is echoed on tool-call replay (HTTP 400 fix).
- Gemini tool schemas are sanitized (draft-7 keywords Gemini rejects).
- Exhausted daily quota surfaces as `QUOTA` with reset guidance instead of a
  generic provider error.
- Media playback keeps the managed browser open until playback ends; explicit
  stops always close it; autoplay is allowed in the managed profile.

### Security

- API keys stored as DPAPI-encrypted blobs; keys are redacted in logs and
  never exposed to the renderer.
- IPC is allowlist-validated against the shared contract; path guard and
  command policy gate file and terminal operations.

### Documentation

- `docs/IMPLEMENTATION_PLAN.md`: repository audit against the IGRIS 2.0
  requirements plus the phased roadmap (Phases 5-10 pending).
