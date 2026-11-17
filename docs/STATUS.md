# Implementation status

**Version:** 1.0.0  
**Target:** Windows 10/11 x64  
**State:** Feature-complete for the defined scope, including task-scoped Windows desktop and browser control; verified with automated tests and a packaged build. Live cloud-provider behavior requires your own API key.

## Requirement coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| Premium 3D desktop assistant | Complete | React Three Fiber core, CSS fallback, obsidian/silver/azure system |
| Distinct accent identities | Complete | Azure, violet, silver; persisted and covered by E2E |
| Full navigation | Complete | Home, Chat, Projects, Computer, Models, Tools, Activity, Settings, History |
| Genuine streaming chat | Complete | Three wire adapters, six provider types (including OpenRouter Free and OpenCode Console) + SSE parser; no simulated fallback |
| Persistent history | Complete | SQLite conversations/messages, summaries, search, export |
| Model management | Complete | Add/edit/test/remove providers, model discovery, default routing |
| Secure API keys | Complete | Windows DPAPI via `safeStorage`; main-process only; masked DTOs |
| Permissioned tools | Complete | 10 permissions, 25 tools, risk levels, confirmations, timeouts |
| Task/activity tracking | Complete | Tasks, steps, tool runs, approvals, diagnostics |
| Cancellation | Complete | Abort controllers, pending-approval rejection, shutdown cancellation |
| Mini robot launcher | Complete | Minimize shows a compact draggable robot bubble; restore via click or tray; no companion window |
| Browser assistance | Complete | Default-browser handoff plus a separate managed browser profile for approved control |
| Desktop control | Complete | PowerShell/C# operator, UI Automation, windows, input, screenshots, policy gates |
| Control safety | Complete | One approval per task, 20-minute expiry, 120 actions, HUD, Pause/Stop, global stop hotkey |
| Coding/filesystem assistant | Complete | Project scan, tree, editor, search, patch, backups, checkpoints |
| Terminal safeguards | Complete | No shell, allowlist, blocked git/npm operations, output caps |
| No fake AI / no local models | Complete | Provider required; explicit “no local model runtime” messaging |
| Windows 10/11 packaging | Complete | NSIS installer built at `release/IGRIS-1.0.0-x64-Setup.exe` |
| Tests | Complete | 188 unit/integration (1 skipped) + 9 Electron E2E passing |
| Documentation | Complete | README + architecture, security, testing, status docs |
| Secrets excluded from git | Complete | `.gitignore`; no keys or `.env` files in the tree |

## Verified results

```text
npm run typecheck   PASS
npm test            27 files, 188 passed, 1 skipped
npm run test:e2e    9 tests PASS
npm run test:packaged PASS (packaged IGRIS.exe, operator asset, HUD)
npm run pack        PASS -> release/win-unpacked/IGRIS.exe
npm run dist        PASS -> release/IGRIS-1.0.0-x64-Setup.exe
```

Real Edge control smoke (`IGRIS_BROWSER_SMOKE=1`): PASS against a local HTTP server using the dedicated IGRIS profile.

OpenCode Console model discovery: PASS against the live gateway catalogue; free-tier models are excluded because OpenCode rejects non-OpenCode clients. A chat request requires account credits or a Go plan.

OpenRouter free-model discovery: PASS against the live catalogue (16 free models at the time of verification). Paid model IDs are rejected by the provider service guard.

Gemini live verification: PASS — `gemini-3.6-flash` streamed “IGRIS online” through the IGRIS chat engine; 46 models were discovered. The key was stored only as a DPAPI-encrypted blob. A later regression (Gemini HTTP 400 on the draft-7 `exclusiveMinimum` keyword emitted by the desktop tool) is fixed by sanitizing function schemas at the Gemini adapter boundary; the fix is covered by `tests/unit/geminiSchema.test.ts` and was verified live with both a chat reply and an `open yt` tool run.

A second live regression was found and fixed: Gemini 3 attaches an opaque `thoughtSignature` to each function-call part and rejects the next turn with HTTP 400 when it is not echoed back ("Function call is missing a thought_signature in functionCall parts"). IGRIS now carries the signature on `ToolCall` and the Gemini adapter echoes it on replay (`tests/unit/geminiThoughtSignature.test.ts`). A live control run after the fix progressed through `request_computer_control` and 13+ consecutive `browser` actions with no 400s.

Transient provider failures (HTTP 503 high-demand, brief rate limits, network drops) are retried automatically within a turn — up to two extra attempts with 2s/6s backoff — but only when nothing was streamed yet, so delivered output is never duplicated, and only for retryable errors; exhausted daily quotas (`QUOTA`) and auth failures fail fast (`tests/unit/chatRetry.test.ts`).

When retries are not enough — a provider is down, out of daily quota, or hanging until the turn timeout — the turn is retried on the next configured provider with a stored key and model. Fallback covers auth, rate-limit, quota, network, timeout, and provider errors, never runs after output was delivered, and can be turned off with the "Automatic provider fallback" setting (`tests/unit/chatFallback.test.ts`). Live use: a Gemini daily-quota exhaustion or the `gemini-3.6-flash` hang now reroutes the turn to another configured provider instead of failing the run.

Voice output runs entirely in the renderer on Windows `speechSynthesis` voices (Microsoft David/Mark/Zira verified live, `speechSynthesis.speaking` confirmed). Replies are reduced to speakable prose — code blocks, tables, and markdown syntax are stripped (`tests/unit/speech.test.ts`) — and speech is interrupted when you talk, send, or press Stop. Hands-free mode (Settings → Voice) keeps the microphone open between turns; a voice-activity gate skips recordings that never exceeded a speech-level RMS threshold, so silent recordings are not sent for transcription. Live probe: the audio graph runs without a user gesture, silence measures ~0.00005 RMS and audible bursts 0.012–0.06 against the 0.012 gate.

Wake word ("Hey IGRIS") is intentionally deferred: the Chromium SpeechRecognition API in this Electron build fails with `network` (no Google speech backend), per-window Gemini transcription would burn the free daily quota, and a local engine (e.g. Porcupine) requires a vendor AccessKey. Push-to-talk plus optional hands-free mode is the supported voice path; revisit wake word if a local engine is acceptable later.

Agent orchestration (Phase 6 slice): multi-action tasks record a plan via the `plan_task` tool (persisted on the task row, shown in Task Monitor). After any task that used consequential tools (desktop, browser, file writes, terminal, app launches), one bounded verifier call judges only the recorded tool evidence and replies with a JSON verdict — `verified`, `failed`, or `unverified` — persisted on the task and shown in Task Monitor. A `failed` verdict fails the task instead of reporting success; verifier infrastructure failures are recorded as `unverified`, never as verified success. Per-step verdicts are merged back into the plan. Retrying a failed task now resumes from plan progress (completed steps with evidence, verifier finding) instead of restarting blindly. The verifier is on by default and can be turned off in Settings → AI ("Verify consequential actions"); it adds one model call per consequential task (`tests/unit/taskVerification.test.ts`, `tests/unit/planTool.test.ts`).

Memory saves are now duplicate-guarded: `save_memory` normalizes text (case, punctuation, whitespace) and compares token overlap (Jaccard ≥ 0.8) against the existing store; a duplicate is refused with the existing memory id reported, instead of silently adding another near-copy (`src/shared/similar.ts`, `tests/unit/memoryDedupe.test.ts`).

A live "open YouTube and play a song" run demonstrated the remaining hard ceiling: the Gemini free tier allows only **20 `gemini-3.6-flash` requests per day**, so multi-step control tasks exhaust the quota and later requests fail. Exhausted daily quotas now surface as a `QUOTA` error with model-switch/billing guidance and a reset estimate instead of a generic retryable rate limit. The browser-control layer itself was verified live without the model: clicking the first `watch?v=` result on YouTube starts playback (video advances, Pause control appears), so the managed browser, ref-based clicking, and media detection behave correctly once the model quota allows the loop to finish.

Full end-to-end playback was later verified live on `gemini-3.1-flash-lite`: the model approved computer control, searched YouTube, opened the song page, clicked Play through two recoverable tool errors, and finished with "I have opened YouTube and started playing 'Popular' by The Weeknd, Madonna, and Playboi Carti." The control session ended and IGRIS kept the managed browser open with the audio playing ("Keeping the managed browser open because media is playing").

Model availability note (November 2026): Google's `gemini-3.6-flash` intermittently **hangs** instead of erroring (surfaced by IGRIS as a 3-minute provider timeout) and `gemini-3.8-flash`/`3.7-flash`/`3.5-flash`/`gemini-flash-latest` returned 503 high-demand at the same time, while `gemini-3.1-flash-lite` responded normally. The provider model is user-configurable in Settings; switching models there is the remedy when one endpoint is degraded.

Media keep-open: when a control session ends on its own but the managed browser is actively playing audio or video, IGRIS keeps the browser open so music keeps playing; an explicit stop (HUD, hotkey, app quit) always closes it, and a new session is never robbed of its browser by the closing check. The managed browser also launches with media autoplay permitted.

Visual QA at 1442×816: no horizontal overflow on any route; bridge present; Conversation view with the 3D core renders; minimized robot launcher works. Three.js emits a harmless `THREE.Clock` deprecation warning from a dependency.

## Deliberate scope decisions

- **Electron rather than Tauri:** Rust/MSVC toolchains were unavailable; Electron provides native windows, `safeStorage`, and a reliable Windows build with the installed toolchain.
- **Built-in `node:sqlite`:** avoids a native addon and keeps persistence in the main process.
- **Cloud only:** no Ollama, local weights, or hidden fallback. The app refuses to answer without a configured provider.
- **No trading features:** explicitly excluded.
- **No default-profile browser automation:** web handoff opens the user's own browser, which IGRIS cannot read. Approved browser control uses a separate persistent IGRIS Edge/Chrome profile so the user's daily sessions are never exposed.
- **Unelevated by design:** desktop control uses `SendInput` and UI Automation and refuses across UIPI boundaries rather than requesting elevation.
- **Unsigned installer:** signing is a distribution decision; no certificate is included.

## Known limitations

1. **No bundled API key.** A live chat test was not possible in this environment. Streaming, adapters, SSE parsing, request building, and error mapping are implemented and unit-tested; the user must connect a provider.
2. **Unsigned build.** Windows SmartScreen may warn. Production distribution should sign the installer.
3. **Windows-specific.** Screen vision, voice, DPAPI, Recycle Bin are implemented for Windows only.
4. **Terminal allowlist is not a sandbox.** Allowed tools can execute project code (`npm run`, `node -e`, tests, hooks). The permission and confirmations are risk controls, not isolation.
5. **Desktop control needs PowerShell and an interactive session.** If PowerShell is blocked by policy or antivirus, control tools fail with a clear error. IGRIS cannot operate the lock screen or elevated windows.
6. **Control is task-scoped, not a sandbox.** An approved model can operate any unelevated app and read anything visible. The approval, HUD, 20-minute expiry, action budget, and stop hotkey are mitigations.
7. **Web handoff cannot verify pages.** The managed browser can, but only within its own profile; sites requiring the user's daily login must be signed into the IGRIS profile once.
8. **Database is not encrypted.** Only provider keys are encrypted; history and backups rely on Windows account ACLs.
9. **Large files and scans are truncated.** This is intentional to protect context, memory, and latency.

## Future work

- Code signing and automatic updates (with a verified signature chain).
- Encrypted local database option.
- Provider-specific live integration tests in CI using short-lived test keys.
- OCR and screen-region selection as a fallback when UI Automation is thin.
- Richer control-session audit view and per-session replay.
- Richer diff review before file writes.
- Per-workspace permission profiles.
- macOS/Linux window and credential abstractions.
- Installer upgrade/uninstall automation.

## Commit and release checklist

- [x] Source builds without TypeScript errors.
- [x] Unit/integration tests pass.
- [x] Electron E2E tests pass.
- [x] Visual QA screenshots reviewed.
- [x] Unpacked build launches.
- [x] NSIS installer builds.
- [x] README and security/architecture/testing docs written.
- [x] `.gitignore` excludes builds, dependencies, test artifacts, screenshots, and secrets.
- [x] Initialized git, created [`samarthimasal-oss/igris`](https://github.com/samarthimasal-oss/igris), committed, pushed `main`, and verified the remote commit.
- [x] Implemented and verified task-scoped desktop and browser control on `feature/desktop-control`.
- [x] Rebuilt the installer with the final operator script and HUD; packaged smoke passes.
- [x] Fixed the Gemini 3 `thoughtSignature` rejection that broke every turn after a tool call.
- [x] Added daily-quota detection with reset guidance and media-aware browser keep-open behavior.
- [x] Added automatic retry for transient provider failures within a turn.
- [x] Added automatic provider fallback with a settings toggle (Phase 2 slice).
- [x] Added voice output (Windows `speechSynthesis`), hands-free listening, voice-activity detection, and interruptible speech (Phase 5 slice).
- [x] Added the agent orchestration slice: persisted `plan_task` plans, an evidence-based verifier pass with settings toggle, per-step verdicts merged into plans, and plan-aware task retries (Phase 6 slice).
- [x] Added memory duplicate detection on save (Phase 7 slice).
- [x] Added an automatic recovery checkpoint before renames; writes and patches already auto-backup (Phase 8 slice).

- **Initial release commit:** `c315cd7a09641a33d0337214c607a12f9b32e447`
- **Remote:** `https://github.com/samarthimasal-oss/igris`
- **Desktop-control branch:** `feature/desktop-control`
- **Installer SHA-256:** `94EE8FBE458F76D9FF217814C02EF24D6D6E5760D0DA6216B7FCA2E3934B01B2` (predates the provider-fallback slice; the installer is rebuilt and the checksum refreshed at the next packaging checkpoint)

The NSIS installer is built locally but intentionally not committed. It is unsigned and is not attached to a GitHub release.
