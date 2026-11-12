# Testing

IGRIS has three verification layers plus a visual QA harness. The goal is to test the boundaries that matter — parsing, path confinement, command policy, settings normalization, persistence, IPC validation, and real Electron startup — without committing credentials or depending on a live provider.

## Commands

```powershell
# Fast feedback
npm run typecheck
npm test

# Full Electron smoke suite (builds first)
npm run test:e2e

# Visual QA screenshots
npm run visual

# Packaging
npm run pack
npm run dist
```

## Current results

Verified on Windows 11 (10.0.26200) with Node 24.18.0, Electron 45.1.0, and npm 12.2.1:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass (node + web) |
| `npm test` | **141 passing**, 1 skipped, 19 files |
| `npm run test:e2e` | **9 passing**, 1 worker |
| `npm run test:packaged` | Pass; packaged `IGRIS.exe` boots, bridges, navigates |
| `npm run pack` | Pass; `release/win-unpacked/IGRIS.exe` |
| `npm run dist` | Pass; `release/IGRIS-1.0.0-x64-Setup.exe` |
| Visual QA | 13 screenshots captured, no horizontal overflow at 1442×816 |

Live provider calls are intentionally not automated because no API key is present in the repository. The adapters can be exercised manually with a key as described below. OpenRouter catalogue discovery and a streamed Gemini reply were verified manually during development.

## Unit tests

### `tests/unit/sse.test.ts`

- standard SSE blocks, event fields, and comments;
- CRLF delimiters split across chunks;
- multi-line `data:` fields;
- UTF-8 characters split across chunks;
- trailing block without a blank line;
- malformed JSON and capped error bodies.

### `tests/unit/commandPolicy.test.ts`

- quoted and empty arguments;
- rejection of shell operators/expansion;
- allowlist resolution and risk levels;
- blocked git operations (`push`, `reset --hard`, `clean -f`, `filter-branch`);
- blocked npm publish/login commands;
- unknown executables.

### `tests/unit/pathGuard.test.ts`

- in-workspace resolution and safe relative paths;
- missing-file policy;
- traversal, absolute paths, drive letters, null bytes, and `~`;
- a real NTFS junction escaping the workspace (skipped gracefully if junction creation is unavailable);
- normalized relative helpers.

### `tests/unit/redaction.test.ts`

- OpenAI/Anthropic/Google (legacy `AIza` and new `AQ.`)/GitHub key patterns;
- bearer tokens, labelled secrets, query parameters;
- truncation and redact-then-truncate behavior.

### `tests/unit/openrouter.test.ts`

- free-only provider registration and locked base URL;
- `:free` model-ID detection, including whitespace trimming;
- catalogue filtering plus bearer and `x-title` headers;
- streaming a free model through Chat Completions.

### `tests/unit/opencode.test.ts`

- pay-as-you-go and Go catalogue URL derivation;
- free-model detection and exclusion;
- gateway session header on streamed requests;
- provider registration and default endpoint.

### `tests/unit/settings.test.ts`

- deep merge without sibling loss or base mutation;
- normalization from corrupt/partial stored JSON;
- numeric clamps, enum repair, rounding.

### `tests/unit/errors.test.ts`

- retryability metadata;
- internal/user message separation;
- abort-to-cancellation mapping;
- serialization without internal leakage;
- HTTP status mapping (401/403/404/429/402/5xx).

### `tests/unit/taskState.test.ts`

- normal planning path;
- same-status no-op;
- terminal-state lock;
- cancellation from every active state;
- invalid transition errors.

### `tests/unit/controlSession.test.ts`

- create and bind a session to a task;
- scope enforcement for desktop, browser, and both;
- 20-minute expiry with a fake clock;
- pause/resume, stop, and task end;
- action budget and no-session rejection.

### `tests/unit/controlPolicy.test.ts`

- key-chord parsing and rejection;
- password, elevated, credential-manager, and self-window blocks;
- HTTP(S)-only URL validation;
- sensitive-text heuristics for checkout/send patterns.

### `tests/unit/desktopService.test.ts`

- action dispatch and target resolution;
- close-window, shell-typing, and first-launch confirmations;
- password-field refusal and stale UIA refs;
- release-all behavior when the operator is absent.

### `tests/unit/operatorProtocol.test.ts`

- JSON-line framing, handshake, and request/response correlation;
- request timeout and crash restart;
- release-all on stop;
- clean disposal.

### `tests/unit/browserSnapshot.test.ts`

- snapshot caps and ref injection;
- password-value redaction;
- URL scheme rejection;
- stale-ref errors.

### `tests/unit/toolRuntimeControl.test.ts`

- `forceConfirmation` always prompts;
- `ToolContext.confirm` denial paths;
- denied results are returned to the model without retry.

### `tests/unit/chatControl.test.ts`

- control runs use at least 30 turns;
- context keeps at most two screenshots;
- session ends in `finally`;
- system prompt includes control and stop rules.

### `tests/unit/geminiSchema.test.ts`

- numeric `exclusiveMinimum`/`exclusiveMaximum` become inclusive `minimum`/`maximum`;
- unsupported draft-7 keywords are dropped while the rest of the schema survives;
- every provider tool schema is free of keywords Gemini rejects;
- the positive window `handle` bound no longer rejects the request.

## Integration tests

`tests/integration/database.test.ts` uses an in-memory `node:sqlite` database and the real repositories:

- schema version and allocation;
- settings round-trip;
- conversation creation, transcript search, summaries, rename rules;
- message ordering, recent-message window, cascade delete, delete-and-following;
- provider default uniqueness, encrypted-key BLOB round-trip, patch/remove;
- task steps and tool runs in order, detail view, cancellation, interrupted-task recovery;
- workspace deduplication by path, kind updates, removal.

No temporary database files are left behind.

`tests/integration/browserSmoke.test.ts` is opt-in and uses a real installed browser:

```powershell
$env:IGRIS_BROWSER_SMOKE = "1"
npm test
```

It starts a local HTTP server, launches the managed Edge profile, navigates, snapshots, clicks, types, and verifies the result. It never touches the user's daily browser profile. Without the variable the test is skipped.

## Electron end-to-end tests

`tests/e2e/smoke.spec.ts` launches the built app with `_electron.launch({ args: ['.'] })` and an isolated profile:

```ts
IGRIS_E2E=1
IGRIS_USER_DATA=<temp directory>
```

Coverage:

1. **Boot and bridge** — title, `window.igris` methods, no horizontal overflow, no uncaught renderer errors.
2. **Navigation** — every page route renders (`.home-page`, `.chat-page`, `.projects-page`, `.computer-page`, `.models-page`, `.tools-page`, `.activity-page`, `.settings-page`, `.history-page`), each without horizontal overflow; the Conversation page no longer contains the thread rail.
3. **Appearance IPC** — clicking the violet accent changes `data-accent` and persists to the main process; reduce-motion toggles round-trip; azure is restored.
4. **Provider validation** — the form rejects a plain-HTTP non-local URL, shows the main-process error, and persists zero providers.
5. **OpenCode preset** — selecting OpenCode fills the gateway endpoint.
6. **OpenRouter preset** — selecting OpenRouter Free fills the locked endpoint and shows the free-only notice.
7. **Minimize launcher** - minimizes the workspace, verifies the robot bubble opens, clicks it, and confirms the main window is restored and the bubble hides.
8. **Control HUD** — starts a session through the E2E hook, verifies the HUD and Home strip show the goal, pauses/resumes from both surfaces, stops, and confirms the HUD hides and the strip clears.
9. **Control approval** — emits a `request_computer_control` confirmation, verifies the goal, **Allow for this task**, and stop hotkey copy, then resolves it as denied and confirms the modal closes.

The test profile is removed after the run. Playwright traces are retained on failure under `test-results/`.

### Packaged smoke test

`scripts/packaged-smoke.mjs` launches the actual packaged executable, not the source tree:

```powershell
npm run test:packaged
```

It verifies that the ASAR bundle includes the preload and renderer, that `node:sqlite` loads inside the packaged Electron runtime, that the onboarding gate can be dismissed, that the bridge is present, and that client-side routing reaches Settings. It also checks that the packaged main bundle contains the operator asset and HUD renderer entry, so desktop control does not fail only after installation. This catches packaging regressions that source-mode E2E cannot.

### Adding an end-to-end test

- Keep one worker; Electron instances share a single-instance lock and global windows.
- Never use the real `%APPDATA%\IGRIS` profile. Pass `IGRIS_USER_DATA`.
- Prefer the bridge for setup and the visible UI for assertions.
- Assert on accessible names/roles where possible.
- Collect `pageerror` events and fail on unexpected exceptions.

## Visual QA

`npm run visual` builds the production renderer, launches Electron, dismisses onboarding, visits every route, captures `screenshots/*.png`, captures the Conversation view with the 3D core, minimizes into the robot launcher, and audits document width and the `window.igris` bridge.

The harness is intentionally separate from the pass/fail test suite: it produces artifacts for human review. Current screenshots cover:

1. onboarding
2. home
3. chat
4. projects
5. computer
6. models
7. tools
8. activity
9. settings
10. permissions
11. chat
12. history
13. minimized robot launcher

Known non-blocking console output: Three.js emits `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` from a dependency. It does not affect rendering or behavior.

## Manual verification checklist

Before releasing a build:

### Provider path

- [ ] Add each provider kind; verify key masking after save.
- [ ] OpenRouter Free: save a key, fetch free models, and confirm a paid model ID is rejected.
- [ ] OpenCode Console: save a key, fetch paid models, and test a chat with credits or a Go plan.
- [ ] Gemini: save a key, fetch models, and stream a reply from a current text model such as `gemini-3.6-flash`.
- [ ] Test a bad key → actionable auth error, no crash.
- [ ] Test a valid key and model → real streaming response.
- [ ] Fetch models where supported.
- [ ] Cancel a stream mid-response → partial message preserved, run marked cancelled.
- [ ] Remove a provider and its stored key.

### Tools

- [ ] Add a project with the filesystem permission off → reads blocked.
- [ ] Grant read → file tree/search works; a junction outside the project is rejected.
- [ ] Grant write → overwrite creates a backup; delete goes to the Recycle Bin.
- [ ] Terminal: allowed command runs; `git push` and shell chaining are blocked.
- [ ] Deny a confirmation → tool run is marked denied, no side effect.
- [ ] Let a confirmation expire → run fails safely.
- [ ] Screen vision with permission → capture lands in the local screenshot folder and the image is attached to the model for that run.
- [ ] Browser: open a page, web search, and YouTube search all open in the default browser; IGRIS reports it cannot read or control the page.

### Desktop and browser control

- [ ] Settings shows `Control this computer` and `Control web pages` off by default; enabling persists across restart.
- [ ] `request_computer_control` always prompts, even with sensitive-action confirmations off.
- [ ] Deny leaves no session and no HUD.
- [ ] Approve opens the HUD; Pause blocks the next action; Resume continues; Stop hides the HUD and releases input.
- [ ] `Ctrl+Alt+Shift+X` stops an active task; the shortcut is absent when no session is running.
- [ ] “Open Notepad and type a haiku” completes and can be verified with `elements` or a screenshot.
- [ ] Typing into a password field and Task Manager is refused with a clear message.
- [ ] Typing into Windows Terminal asks for confirmation.
- [ ] Closing a window asks for confirmation; first launch of a new app asks once per session.
- [ ] The managed browser opens with the dedicated profile, navigates to a local or public page, snapshots, clicks, and types.
- [ ] `file://`, `javascript:`, and `data:` URLs are rejected by the browser tool; downloads/uploads are blocked.
- [ ] Browser screenshots stay at or below 1280 px and the model context keeps at most two images.

### Windows behavior

- [ ] Minimize/restore, the draggable robot bubble, tray menu, close-to-tray setting, second-instance focus.
- [ ] Toggle each accent, 3D off, reduced motion; restart and confirm persistence.
- [ ] Uninstall/reinstall the NSIS package; user data remains unless explicitly cleared.
- [ ] Verify SmartScreen behavior on the unsigned installer.
- [ ] Check `%APPDATA%\IGRIS\data\igris.db` is created and diagnostics are redacted.

### Failure paths

- [ ] Launch with a corrupt settings JSON → defaults load.
- [ ] Launch with the DB locked/unavailable → clear startup error dialog.
- [ ] Kill the app during a run → next launch marks the task interrupted.
- [ ] Simulate provider 429/500/timeout → correct code and retryability.

## What is not covered

- Live cloud responses and provider-specific model behavior.
- Exhaustive input automation across every multi-monitor and DPI configuration; the operator is DPI-aware but coverage is a smoke test plus manual checks.
- Arbitrary third-party websites or sites requiring authentication.
- Installer upgrade/uninstall flows under all Windows policies.
- Code signing and SmartScreen reputation.
- Security against malware running as the same Windows user.

These are documented limitations, not hidden claims.
