# IGRIS

**A premium personal AI assistant for Windows.** One calm, three-dimensional surface for asking, researching, writing code, and directing your machine — with every consequential action held behind explicit permission and approval.

IGRIS is a native Electron application with a React interface, real cloud-model streaming, a local SQLite history, a separate always-on-top robot companion, and a permissioned tool runtime for files, terminals, applications, screen capture, and a controlled browser.

![IGRIS command deck](docs/images/home.jpg)

> **Cloud intelligence only.** IGRIS does not ship a local model, does not silently fall back to one, and never fabricates an assistant response when no provider is configured. Add your own OpenAI, Anthropic, Gemini, OpenRouter, OpenCode Console, or OpenAI-compatible key.

---

## Highlights

- **Immersive command deck** — obsidian, titanium, and electric-azure design with a procedural 3D core, graceful CSS fallback, and three accent identities.
- **Genuine streaming chat** — SSE streaming from cloud providers, persistent conversations, cancellation, usage metadata, and provider-aware error messages.
- **29 permissioned tools** — project inspection, file read/search/write/patch, checkpoints, allowlisted terminal commands, app launch, screen capture, native input, browser control, YouTube assistance, and memory.
- **Approval by design** — sensitive tools require a granted capability *and* a per-call confirmation. High-risk tools are marked, logged, and time-limited.
- **A separate companion** — a frameless, transparent, movable robot window that stays above other applications, accepts quick asks, and reflects live assistant state.
- **Native browser surface** — a sandboxed `WebContentsView` in its own window with an IGRIS toolbar, downloads blocked, permissions denied, and navigation constrained to HTTP(S).
- **Local-first persistence** — conversations, tasks, tool runs, memories, logs, and settings live in a local SQLite database.
- **Windows DPAPI credentials** — provider keys are encrypted with Electron `safeStorage`, used only in the privileged main process, and never sent back to the interface.
- **Auditable activity** — every task, step, tool call, approval, and result appears in Activity, with diagnostic export.

![IGRIS conversation](docs/images/chat.jpg)

## What IGRIS is not

- Not a local-model runner. Ollama and bundled models are intentionally out of scope.
- Not a trading or financial automation tool.
- Not an autonomous agent that bypasses confirmations. The model proposes; you decide.
- Not a hosted service. Your history stays on this PC; prompts go only to the provider you configure.

---

## Quick start

### Requirements

- Windows 10 or 11 (x64)
- Node.js 22 or newer (developed on Node 24)
- npm 10 or newer
- A cloud provider API key

### Run from source

```powershell
npm install
npm run dev
```

`npm install` runs `node node_modules/electron/install.js` in `postinstall` to guarantee the Electron 45 binary is present.

### Build the Windows installer

```powershell
npm run dist
```

Output: `release/IGRIS-1.0.0-x64-Setup.exe` (NSIS, per-user install, selectable directory).

The installer is **unsigned** because no code-signing certificate is configured. Windows SmartScreen may warn until the binary is signed.

### Connect a provider

1. Open **AI models**.
2. Choose **Add provider** and select OpenAI, Anthropic, Google Gemini, OpenRouter Free, OpenCode Console, or an OpenAI-compatible endpoint.
3. Enter a display name, optional base URL, API key, and model ID.
4. Use **Test connection** to verify the key and model before relying on it.
5. Save. The first provider becomes the default; additional providers can be promoted in one click.

Keys are encrypted with Windows DPAPI in the main process. After saving, the interface receives only a masked hint such as `••••abcd`. API usage is billed by the provider, not by IGRIS.

### OpenRouter Free

OpenRouter offers a rotating catalogue of free models through an OpenAI-compatible API. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys) and choose **OpenRouter Free**.

- The base URL is locked to `https://openrouter.ai/api/v1`.
- **Fetch** lists only models whose IDs end in `:free`. IGRIS rejects paid IDs when saving, testing, or starting a chat.
- No OpenRouter credits are needed for `:free` models, but they are rate-limited.
- Some free models require enabling prompt logging in your OpenRouter privacy settings.
- The free catalogue rotates. If a model disappears or is throttled, fetch again and choose another `:free` model.

### OpenCode Console

OpenCode Console is a model gateway: one `oc_sk_...` key reaches Claude, GPT, Gemini, and open coding models. Create a personal key in the [OpenCode Console](https://opencode.ai/console) and choose **OpenCode Console** in IGRIS.

- Pay-as-you-go base URL: `https://opencode.ai/inference/openai/v1`
- Go base URL: `https://opencode.ai/inference/go/openai/v1` (IGRIS sends the stable `x-opencode-session` header Go requires)
- Good coding defaults: `claude-sonnet-5-5` or `gpt-6.1-sol`; cheaper alternatives include `glm-5.3` and `deepseek-v4.1-flash`
- **Fetch** lists only paid models. OpenCode's free-tier models are restricted to OpenCode and return HTTP 403 from other clients.
- The Console account must have credits or an active Go plan; otherwise requests fail with a clear insufficient-funds error.

![IGRIS AI models](docs/images/models.jpg)

---

## Permissions

Every capability is off by default. Enable only what you need in **Settings → Permissions**.

| Permission | What it unlocks | Default |
| --- | --- | --- |
| Read approved projects | List, preview, search files inside folders you add | Off |
| Modify files | Create, edit, patch, rename, move, delete with backups | Off |
| Coding agent actions | Checkpoints and project test runs | Off |
| Run terminal commands | Allowlisted development commands inside a project | Off |
| Launch applications | Start apps from a fixed, verified list | Off |
| Browser automation | Open, read, click, fill, YouTube search/control | Off |
| Screen access | Capture the primary display on explicit request | Off |
| Keyboard and mouse control | Type, press keys, click coordinates (experimental) | Off |

Sensitive actions still require a per-call confirmation by default (`Settings → Intelligence → Confirm sensitive actions`). File writes create a backup; deletes go to the Windows Recycle Bin where possible; terminal commands run without a shell and are constrained by an executable allowlist.

### Tool inventory

| Group | Tools |
| --- | --- |
| Projects | `list_projects`, `inspect_project` |
| Files | `read_file`, `search_files`, `write_file`, `apply_patch`, `create_entry`, `rename_entry`, `delete_entry` |
| Code & terminal | `create_checkpoint`, `run_command`, `run_tests` |
| Applications | `list_apps`, `launch_app`, `list_windows` |
| Screen & input | `capture_screen`, `type_text`, `press_keys`, `click_at` |
| Browser | `browser_open`, `browser_search`, `youtube_search`, `browser_read`, `browser_click`, `browser_fill`, `youtube_control` |
| Memory & system | `save_memory`, `search_memories`, `current_time` |

The model never receives a raw shell. It receives typed tool schemas; the main process validates arguments, checks permissions, applies risk policy, requests approval when needed, enforces timeouts and output caps, and records the run.

![IGRIS toolkit](docs/images/tools.jpg)

---

## The companion

The companion is its own native window: frameless, transparent, draggable, and always-on-top. It reports idle, listening, thinking, working, success, and error states, accepts a quick ask into the main workspace, and can be pinned or hidden independently.

![IGRIS companion](docs/images/companion.jpg)

---

## Architecture at a glance

```text
┌───────────────────────────── Renderer (sandboxed) ─────────────────────────────┐
│ React 19 + TypeScript + Vite · Home / Chat / Projects / Computer / Models /    │
│ Tools / Activity / Settings · React Three Fiber core · companion & browser UI  │
└───────────────────────────────▲────────────────────────────────────────────────┘
                                │ typed contextBridge API (preload)
┌───────────────────────────────┴────────────────────────────────────────────────┐
│ Electron main process                                                          │
│  ProviderService → adapters (OpenAI / Anthropic / Gemini /                     │
│  OpenRouter / OpenCode) · streaming, tool calls, discovery                     │
│  ChatEngine → streaming runs, cancellation, tool loop                          │
│  ToolRuntime → permissions, confirmations, risk, timeouts, audit                │
│  Services → files, terminal, apps, screen, input, browser                       │
│  Storage → node:sqlite repositories · CredentialStore (DPAPI) · Logger          │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Single writer:** all privileged operations, network calls, SQLite access, and secret decryption live in the main process.
- **Typed boundary:** the preload exposes a narrow promise-based API; IPC methods are validated with Zod and role-checked per window.
- **Hardened renderer:** `contextIsolation`, `sandbox`, no Node integration, a restrictive CSP, and no remote module.
- **Deterministic lifecycle:** one app instance, tray-resident shutdown, interrupted-task recovery, and explicit window roles.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full walkthrough.

---

## Data locations

IGRIS uses the Electron per-user data directory, normally:

```text
%APPDATA%\IGRIS\
  data\igris.db          SQLite database (including diagnostic events)
  data\backups\          file-write backups
  data\screenshots\      explicit screen captures
```

Use **Settings → Privacy & data** to export data, clear conversation and memory history, change retention, or disable conversation saving. No telemetry is sent anywhere.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Electron + Vite development with HMR |
| `npm run build` | Type-check and build main, preload, renderer, and companion |
| `npm start` | Preview the production build |
| `npm test` | Vitest unit and integration suite |
| `npm run test:e2e` | Build, then run Playwright Electron smoke tests |
| `npm run test:packaged` | Pack, then smoke-test the packaged `IGRIS.exe` |
| `npm run pack` | Unpacked Windows build in `release/win-unpacked` |
| `npm run dist` | NSIS installer in `release/` |
| `npm run visual` | Capture the visual QA screenshot set |
| `npm run icons` | Regenerate application and tray icons |

### Verification status

- `npm run typecheck` — passing
- `npm test` — **79 tests passing** across 10 files
- `npm run test:e2e` — **7 Electron smoke tests passing**
- `npm run test:packaged` — packaged `IGRIS.exe` boots, bridges, and routes
- `npm run pack` — passing (`release/win-unpacked/IGRIS.exe`)
- `npm run dist` — passing (`release/IGRIS-1.0.0-x64-Setup.exe`)

Live provider calls are not part of the automated suite because no API key is committed. The adapters, SSE parser, error mapping, and request building are covered; configure a key to exercise a real stream. Manual verification also exercised OpenRouter's free catalogue and a streamed Gemini `gemini-3.6-flash` reply through the chat engine.

See [docs/TESTING.md](docs/TESTING.md) for details.

---

## Project layout

```text
src/
  main/          Electron main process
    ai/          provider adapters, SSE, HTTP, chat engine
    security/    credentials, path guard, command policy, redaction, errors
    services/    files, terminal, apps, screen, input, browser, provider, settings
    storage/     SQLite database and repositories
    tasks/       task state and orchestration
    tools/       tool registry and runtime
    windows/     main, companion, paths
    ipc.ts       validated dispatcher and role allowlists
    index.ts     boot, lifecycle, wiring
  preload/       contextBridge and type declarations
  renderer/      React application and companion UI
  shared/        types, defaults, settings normalization, IPC contract
tests/
  unit/          pure security, settings, SSE, error, state tests
  integration/   in-memory SQLite repository tests
  e2e/           Playwright Electron smoke tests
docs/            architecture, security, testing, status, screenshots
scripts/         icons and visual QA
```

---

## Security

The security model is documented in [docs/SECURITY.md](docs/SECURITY.md). In brief:

- API keys are encrypted at rest with Windows DPAPI and decrypted only for a provider call.
- The renderer never receives a stored key; the bridge returns masked hints only.
- All filesystem access is confined to explicitly approved workspaces with lexical and real-path checks.
- Terminal commands are parsed without a shell, checked against an executable allowlist, and blocked for destructive git/npm operations.
- Browser content runs in a dedicated sandboxed session; permissions and downloads are denied by default.
- Logs and diagnostic exports redact common credential patterns.
- High-risk actions require confirmation and are recorded in Activity.

Please do not open a public issue containing an API key, personal path, or conversation content. See the security document for reporting guidance.

---

## Limitations

- **Windows only** at this time. The UI is responsive, but native window and input paths target Windows.
- **Cloud keys required.** There is no bundled model, no offline inference, and no local fallback.
- **Unsigned installer.** Code signing is intentionally left to the distributor.
- **Input control is experimental.** Screen capture and synthetic input depend on display configuration and app focus; verify before use.
- **Browser automation sees the visible IGRIS browser page.** It does not automate other browsers or bypass site authentication, CAPTCHAs, or anti-bot controls.
- **Live provider behavior varies.** Model IDs, tool-calling support, quotas, and rate limits are controlled by the provider.

## License

MIT © 2026 Samarth. See [LICENSE](LICENSE).
