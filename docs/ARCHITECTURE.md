# Architecture

IGRIS is a Windows desktop application built on Electron. It deliberately keeps every privileged capability in the main process and treats the renderer as untrusted presentation code.

## Design goals

1. **Real capability, no theatre.** Chat is streaming provider I/O. Tools perform real filesystem, terminal, screen, and voice operations, and web tools hand URLs to the system browser. There is no simulated assistant fallback.
2. **Least privilege.** Renderer sandboxing, a narrow IPC surface, default-off permissions, per-call approvals, and path/command allowlists.
3. **Local ownership.** SQLite history, local backups, local screen captures, and DPAPI-encrypted credentials.
4. **Calm, premium surface.** A single design system, a procedural 3D core in the Conversation view, responsive layouts, reduced-motion support, and a compact robot launcher on minimize.
5. **Operable by humans.** Every tool call becomes an auditable task step with a status, arguments, result, approval state, and timing.

## Process and window model

```text
main process
├── MainWindow          frameless 1440×920 shell, all pages, custom titlebar
├── MiniLauncher        112×112 transparent bubble shown on minimize
├── ControlHud          360×92 frameless control bar, visible only during a control session
└── Tray                background residency and quick actions
```

- All windows use `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- A `Map<webContents.id, WindowRole>` assigns every window a role. The IPC dispatcher checks the methods allowed for that role.
- The main window may call every method. The mini launcher may only restore the main window. The HUD may only read control state and pause, resume, or stop.
- A 112x112 transparent, always-on-top robot bubble appears when the main window is minimized. It is draggable, restores the workspace on click, and hides when the main window returns.
- During an approved control session, a 360×92 always-on-top HUD shows the goal, current action, action count, and Pause/Resume/Stop. It appears with `showInactive()` so it never steals focus, and it hides when the session ends.
- The application is single-instance and tray-resident. Shutdown cancels active chat runs, releases held input, closes the managed browser, unregisters global shortcuts, closes windows, optionally clears history, and closes SQLite cleanly.

## Boot sequence

`src/main/index.ts`:

1. Set the app name, optional test/user-data override, and request the single-instance lock.
2. Wait for Electron readiness; apply the Content Security Policy and allow only the microphone permission while denying the rest.
3. Create the data directories and open `data/igris.db`.
4. Construct repositories, settings, logger, credential store, provider service, window managers, services, tasks, tools, chat, and IPC.
5. Copy the bundled `operator.ps1` to `<userData>/operator/`, construct `OperatorClient`, `DesktopService`, and the control `BrowserService`, and wire `ControlSessionService`, the HUD, and the stop hotkey.
6. Mark unfinished tasks as interrupted, apply retention policy, and register the settings listener.
7. Show the main window, create the tray, and wire the voice transcription service.
8. Register shutdown hooks: cancel runs, release input, close the managed browser, close windows, close the DB, quit.

## Renderer

- React 19 + TypeScript + Vite, `HashRouter` routes: Home, Chat, Projects, Computer, Models, Tools, Activity, Settings, History.
- Zustand store coordinates settings, providers, tools, health, conversations, tasks, toasts, confirmations, and the active control session.
- The 3D core uses React Three Fiber/Three.js with a procedural scene and renders as a background layer in the Conversation view. `appearance.show3d`, quality, animation intensity, reduced motion, and the selected accent are settings-driven.
- If WebGL is unavailable, the component renders a static CSS core instead of failing the page.
- The minimized launcher is a separate HTML entry (`mini.html`) and React root, styled by `mini.css`.
- The control HUD is a separate HTML entry (`hud.html`) and React root, styled by `hud.css`. It is deliberately small and independent of the main renderer.
- The Home terminal status area shows a `CONTROL` strip with the goal, current action, action count, and Pause/Resume/Stop while a session is active.
- Web pages are never rendered inside the app. The existing web tools hand URLs to the default browser; an approved `browser` control session drives a separate, dedicated Edge/Chrome profile.

## IPC boundary

The shared contract lives in `src/shared/ipc.ts`.

- One invoke channel: `igris:call`. Payloads are `{ method, input }`.
- One response envelope: `{ ok, data }` or `{ ok: false, error: { code, message, retryable } }`.
- Every method has a Zod schema in `src/main/ipc.ts`; oversized, malformed, or unknown payloads never reach services.
- The dispatcher verifies the sender is a known `webContents` role and that the method is in that role's allowlist.
- Event channels push chat deltas, task changes, drafts, and navigation without letting the renderer invoke privileged code.
- The preload exposes a typed `window.igris` object with namespaced methods; no raw `ipcRenderer` is exposed.

This boundary is the reason renderer code can be rich without becoming a security hole.

## AI layer

### Provider adapters

`src/main/ai/providers/` contains three wire adapters serving six provider types:

| Provider type | Wire protocol | Notes |
| --- | --- | --- |
| OpenAI | Chat Completions | SSE streaming, native tool calls, usage chunk |
| Anthropic | Messages API | Content blocks, `tool_use`/`tool_result`, SSE events |
| Gemini | Generative Language API | `streamGenerateContent`, function calls |
| OpenRouter Free | Chat Completions | Reuses the compatible adapter; locks the base URL and filters discovery to `:free` models |
| OpenCode Console | OpenAI Chat Completions gateway | Reuses the compatible adapter; lists paid models from the gateway catalogue |
| OpenAI-compatible | Chat Completions | Configurable base URL and tool support |

OpenCode Console translates each request to the model's native API, so Claude, GPT, Gemini and open models all work through the same Chat Completions base URL. Its model catalogue lives at the gateway root (`/inference/v1/models`), which the OpenAI adapter derives from the configured base URL; free-tier models are filtered because OpenCode rejects external clients for those models.

OpenRouter Free uses the same compatible adapter but applies a stricter contract: the base URL is fixed, discovery returns only IDs ending in `:free`, and `ProviderService` rejects a paid model ID at save, test, or chat time. This keeps the provider from silently routing to a billed model.

`src/main/ai/http.ts` normalizes/validates base URLs, performs fetch, maps HTTP failures, and cancels cleanly. `src/main/ai/sse.ts` is an incremental SSE parser that handles CRLF, chunk splits, multi-line data, comments, and trailing events.

`ProviderService` resolves credentials only at call time, validates provider input, encrypts keys, and keeps only masked hints in DTOs. Connection tests and model discovery go through the same main-process path.

### Chat engine

`src/main/ai/chatEngine.ts` owns a run from start to finish:

1. Resolve the provider, model, temperature, context window, and system instructions.
2. Create or continue the conversation; persist the user message.
3. Create a task and nested steps for the run.
4. Build the message list from recent history plus relevant memory/workspace context.
5. Stream provider events to the renderer. Text arrives incrementally; usage is recorded.
6. Accumulate tool calls, execute them through `ToolRuntime`, persist tool results, and feed them back into the next model turn.
7. Repeat until the model finishes or `maxToolIterations` is reached.
8. Persist the final assistant message and finish the task with a result or a structured failure; in a `finally`, end any control session bound to the task.

Control runs raise the effective turn limit to at least 30 and prune older tool-result images so at most two screenshots remain in the active context. Each turn re-checks the session, so pause, stop, or expiry takes effect before the next action.

Runs have an `AbortController`, a global deadline, cancellation on app shutdown, per-run confirmation tracking, and replay protection so a repeated tool call cannot loop forever. Errors are serialized as stable codes (`AUTH`, `RATE_LIMIT`, `QUOTA`, `NETWORK`, `TIMEOUT`, `PERMISSION`, etc.) with retryability metadata.

## Tools

`src/main/tools/registry.ts` defines 25 tools with Zod argument schemas, human titles, categories, risk levels, permission keys, confirmation flags, timeouts, and handlers. Handlers receive resolved services and a signal.

The three control tools are `request_computer_control`, `desktop`, and `browser`. `request_computer_control` always prompts and creates a task-scoped session. `desktop` and `browser` require that session and its scope, and pass a per-action confirmation callback for close-window, shell-typing, first-launch, and checkout/send gates.

`src/main/tools/toolRuntime.ts` is the gatekeeper:

- verifies the tool exists and the args parse;
- checks the required permission against current settings;
- consults the confirmation policy and emits a UI request for sensitive actions;
- applies an approval timeout (2 minutes by default);
- runs the handler with a tool-specific timeout and the run's abort signal;
- caps result size, redacts secrets, and writes a tool-run record;
- cancels pending approvals when the run is aborted.

Tool results are never trusted as UI markup; the renderer treats them as text and renders markdown through a sanitized component.

## Storage

`src/main/storage/database.ts` opens a single SQLite database with WAL, foreign keys, a busy timeout, and a versioned schema. Tables:

| Table | Purpose |
| --- | --- |
| `settings` | JSON settings document |
| `providers` | provider metadata, encrypted key blob, masked hint, default flag |
| `conversations`, `messages` | chat history and message metadata |
| `tasks`, `task_steps`, `tool_runs` | auditable execution graph |
| `workspaces` | explicitly approved project folders |
| `memories` | user-approved durable facts |
| `logs` | redacted diagnostic events |

Repositories keep SQL in one place and return shared DTOs. The renderer never talks to SQLite.

## File, terminal, desktop, and control services

- **FileService** confines all work to `WorkspaceBoundary` (lexical + real-path checks, junction escape prevention), ignores heavy directories during scans, caps file sizes and result counts, creates backup copies before writes, and uses the Recycle Bin for deletes where possible.
- **TerminalService** parses commands without a shell, evaluates them with `commandPolicy.ts`, runs in the workspace with a scrubbed environment, and caps output/time.
- **AppService** launches only a fixed set of verified applications and lists visible window titles when screen access is enabled.
- **ScreenService** captures the primary display to the app's screenshot directory only after permission; the `see_screen` tool converts the capture into a `ToolImage` the model receives as an inline image.
- **OperatorClient** supervises one hidden `powershell.exe` per app run. `operator.ps1` compiles an in-box C# helper for `SendInput`, UI Automation, windows, and screenshots. Requests and responses are newline-delimited JSON; no operator data reaches the renderer.
- **DesktopService** validates `desktop` actions, applies the hard blocks and confirmation gates, resolves apps through the existing allowlist and Start Menu, saves screenshots under `<userData>/screenshots/<taskId>/`, and releases input on stop.
- **Control BrowserService** lazily launches a dedicated persistent Edge profile (Chrome fallback) through `playwright-core`, snapshots interactive elements with injected refs, blocks downloads/uploads and unsafe URL schemes, and closes on session end or app quit.
- **ControlSessionService** owns the task-bound session: scope, 20-minute expiry, 120-action budget, pause/resume/stop, and HUD state.
- **VoiceService** transcribes microphone audio through the resolved default provider's transcription path (Gemini inline audio today) and surfaces a clear error for provider kinds without voice support.

## Web handoff and control

The default-browser handoff embeds no browser. Web tools validate a URL and pass it to Windows' default browser.

- Only HTTP(S) URLs are accepted; credentials embedded in URLs are rejected.
- Named sites ("open YouTube") are opened directly via `browser_open` with their official URL; search-style openers route through the search flow instead.
- `browser_open`, `browser_search`, and `youtube_search` construct the page URL and call `shell.openExternal`.
- Without a control session, the assistant cannot read the page, click elements, fill forms, or control playback afterward.
- With an approved `browser` session, the `browser` tool drives a separate managed Edge/Chrome profile through Playwright. It never attaches to the user's daily profile.
- What the user does with a handoff page stays entirely inside their own browser and its profile.

## Error model

`AppError` carries a stable code, a user-facing message, an optional private internal message, and retryability. `serializeError` strips internals at the IPC boundary, so a raw path, stack trace, or provider body never lands in a toast. The renderer maps codes to actionable hints (for example, an auth error suggests checking the key, a rate limit suggests waiting).

## Extension points

- Add a provider by implementing `ProviderAdapter` and registering it in `ProviderService`.
- Add a tool by defining it in `registry.ts` with a permission, risk, schema, and handler; the runtime handles the rest.
- Add a page by creating a renderer route and a method in the shared IPC contract; add a Zod schema and role policy.
- Add a schema migration by bumping `PRAGMA user_version` and appending an idempotent migration in `Database.migrate`.

## Known architectural limits

- Windows-specific native paths (safeStorage, Recycle Bin, screen, voice, `SendInput`, UIA) are not abstracted for macOS/Linux.
- Web tools cannot inspect or verify what the default browser did with a page; only the managed browser is observable.
- Native control of an existing browser window is possible through `desktop` but is less reliable than the managed browser.
- Large files are truncated rather than streamed.
- No plugin marketplace or third-party tool execution.
