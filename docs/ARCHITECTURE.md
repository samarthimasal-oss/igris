# Architecture

IGRIS is a Windows desktop application built on Electron. It deliberately keeps every privileged capability in the main process and treats the renderer as untrusted presentation code.

## Design goals

1. **Real capability, no theatre.** Chat is streaming provider I/O. Tools perform real filesystem, terminal, browser, screen, and input operations. There is no simulated assistant fallback.
2. **Least privilege.** Renderer sandboxing, a narrow IPC surface, default-off permissions, per-call approvals, and path/command allowlists.
3. **Local ownership.** SQLite history, local backups, local screen captures, and DPAPI-encrypted credentials.
4. **Calm, premium surface.** A single design system, a procedural 3D core, responsive layouts, reduced-motion support, and a separate companion window.
5. **Operable by humans.** Every tool call becomes an auditable task step with a status, arguments, result, approval state, and timing.

## Process and window model

```text
main process
├── MainWindow          frameless 1440×920 shell, all pages, custom titlebar
├── CompanionWindow     frameless transparent 280×340 always-on-top robot
├── BrowserWindow       frameless 1280×820 IGRIS browser shell
│   └── WebContentsView sandboxed page surface on a persistent partition
└── Tray                background residency and quick actions
```

- All windows use `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- A `Map<webContents.id, WindowRole>` assigns every window a role. The IPC dispatcher checks the methods allowed for that role.
- The main window may call every method. The companion may only read/show itself, hide, ask, and open the main window. The browser shell may only manage its own surface.
- The companion is restored to a clamped on-screen position, saves moves after a short debounce, and hides instead of closing.
- The application is single-instance and tray-resident. Shutdown cancels active chat runs, closes windows, optionally clears history, and closes SQLite cleanly.

## Boot sequence

`src/main/index.ts`:

1. Set the app name, optional test/user-data override, and request the single-instance lock.
2. Wait for Electron readiness; apply the Content Security Policy and deny default session permissions.
3. Create the data directories and open `data/igris.db`.
4. Construct repositories, settings, logger, credential store, provider service, window managers, browser, services, tasks, tools, chat, and IPC.
5. Mark unfinished tasks as interrupted, apply retention policy, and register the settings listener.
6. Show the main window, create the tray, and restore the companion if enabled.
7. Register shutdown hooks: cancel runs, dispose the browser, close the DB, quit.

## Renderer

- React 19 + TypeScript + Vite, `HashRouter` routes: Home, Chat, Projects, Computer, Models, Tools, Activity, Settings.
- Zustand store coordinates settings, providers, tools, health, conversations, tasks, companion state, toasts, and confirmations.
- The 3D core uses React Three Fiber/Three.js with a procedural scene. `appearance.show3d`, quality, animation intensity, reduced motion, and the selected accent are settings-driven.
- If WebGL is unavailable, the component renders a static CSS core instead of failing the page.
- The companion is a separate HTML entry and React root, styled by `companion.css`.
- The browser shell is a local React toolbar; the actual page is a main-process `WebContentsView` whose bounds the shell reports over IPC.

## IPC boundary

The shared contract lives in `src/shared/ipc.ts`.

- One invoke channel: `igris:call`. Payloads are `{ method, input }`.
- One response envelope: `{ ok, data }` or `{ ok: false, error: { code, message, retryable } }`.
- Every method has a Zod schema in `src/main/ipc.ts`; oversized, malformed, or unknown payloads never reach services.
- The dispatcher verifies the sender is a known `webContents` role and that the method is in that role's allowlist.
- Event channels push chat deltas, task changes, browser state, companion state, drafts, and navigation without letting the renderer invoke privileged code.
- The preload exposes a typed `window.igris` object with namespaced methods; no raw `ipcRenderer` is exposed.

This boundary is the reason renderer code can be rich without becoming a security hole.

## AI layer

### Provider adapters

`src/main/ai/providers/` contains four adapters:

| Adapter | Wire protocol | Notes |
| --- | --- | --- |
| OpenAI | Chat Completions | SSE streaming, native tool calls, usage chunk |
| Anthropic | Messages API | Content blocks, `tool_use`/`tool_result`, SSE events |
| Gemini | Generative Language API | `streamGenerateContent`, function calls |
| OpenAI-compatible | Chat Completions | Configurable base URL and tool support |

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
8. Persist the final assistant message and finish the task with a result or a structured failure.

Runs have an `AbortController`, a global deadline, cancellation on app shutdown, per-run confirmation tracking, and replay protection so a repeated tool call cannot loop forever. Errors are serialized as stable codes (`AUTH`, `RATE_LIMIT`, `QUOTA`, `NETWORK`, `TIMEOUT`, `PERMISSION`, etc.) with retryability metadata.

## Tools

`src/main/tools/registry.ts` defines 29 tools with Zod argument schemas, human titles, categories, risk levels, permission keys, confirmation flags, timeouts, and handlers. Handlers receive resolved services and a signal.

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

## File, terminal, and desktop services

- **FileService** confines all work to `WorkspaceBoundary` (lexical + real-path checks, junction escape prevention), ignores heavy directories during scans, caps file sizes and result counts, creates backup copies before writes, and uses the Recycle Bin for deletes where possible.
- **TerminalService** parses commands without a shell, evaluates them with `commandPolicy.ts`, runs in the workspace with a scrubbed environment, and caps output/time.
- **AppService** launches only a fixed set of verified applications and lists visible window titles when screen access is enabled.
- **ScreenService** captures the primary display to the app's screenshot directory only after permission.
- **InputService** provides synthetic text/keys/clicks behind the experimental input permission.

## Browser

`BrowserService` creates one controlled browser window with a sandboxed `WebContentsView` on a dedicated persistent session.

- Only HTTP(S) navigation is accepted.
- Popups are denied and optionally loaded in the controlled view after validation.
- Permission requests and downloads are denied.
- The local shell reports its toolbar bounds; the main process keeps the page view aligned.
- Read/click/fill tools operate on the visible page text and DOM without exposing Node APIs.
- The browser session is separate from the app session.

## Error model

`AppError` carries a stable code, a user-facing message, an optional private internal message, and retryability. `serializeError` strips internals at the IPC boundary, so a raw path, stack trace, or provider body never lands in a toast. The renderer maps codes to actionable hints (for example, an auth error suggests checking the key, a rate limit suggests waiting).

## Extension points

- Add a provider by implementing `ProviderAdapter` and registering it in `ProviderService`.
- Add a tool by defining it in `registry.ts` with a permission, risk, schema, and handler; the runtime handles the rest.
- Add a page by creating a renderer route and a method in the shared IPC contract; add a Zod schema and role policy.
- Add a schema migration by bumping `PRAGMA user_version` and appending an idempotent migration in `Database.migrate`.

## Known architectural limits

- Windows-specific native paths (safeStorage, Recycle Bin, screen/input) are not abstracted for macOS/Linux.
- Browser page extraction is best-effort and bounded; complex SPAs may need explicit selectors.
- Large files are truncated rather than streamed.
- No plugin marketplace or third-party tool execution.
