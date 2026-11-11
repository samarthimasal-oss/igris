# Security model

IGRIS is a local desktop agent, not a sandbox. Its security goal is to make powerful actions **visible, permissioned, and reversible where possible**, while keeping the renderer and credentials isolated from untrusted content. This document describes what is enforced and what is not.

## Trust boundaries

| Component | Trust | Capabilities |
| --- | --- | --- |
| Renderer (React) | Untrusted presentation | Only the typed `window.igris` bridge |
| Preload | Narrow, audited bridge | Invoke one IPC channel; no raw `ipcRenderer` |
| Main process | Trusted | Files, processes, SQLite, DPAPI, network, windows |
| Provider responses | Untrusted | Parsed as data; never executed |
| Pages opened in your default browser | Untouched | IGRIS only builds the URL; it cannot read or control the page |
| Pages in the managed IGRIS browser | Untrusted content | Read as data and operated through Playwright, after explicit control approval |
| Screen, window titles, UIA trees, page text | Untrusted content | Cannot change permissions, scope, or safety rules |
| Tool arguments | Untrusted | Zod-validated, permission-checked, policy-checked, confirmed |
| Local user | Trusted administrator | Can grant capabilities, approve actions, read local data |

## Renderer isolation

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` for the main and mini-launcher windows.
- The renderer has no direct Node, filesystem, shell, database, or secret access.
- Production responses receive:

  ```text
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';
  media-src 'self' blob:; object-src 'none'; frame-src 'none';
  worker-src 'self' blob:; base-uri 'none'; form-action 'none'
  ```

  plus `X-Content-Type-Options: nosniff`.
- Default session permission requests and checks are denied.
- External links open in the system browser after an HTTP(S) check; new windows are denied.
- The renderer is a local file load, not a remote URL.

## IPC security

Every renderer call goes through `igris:call` and is:

1. matched to a known `webContents` role (`main`, `mini`, `hud`);
2. checked against a per-role method allowlist;
3. validated by a Zod schema (size, type, enum, numeric range);
4. executed against services in the main process;
5. returned as a typed envelope with sanitized errors.

The minimized launcher may only restore the main window. The HUD may only read control state and pause, resume, or stop the active session.

## Credential handling

- Provider keys are encrypted with Electron `safeStorage`, which uses Windows DPAPI and is bound to the current Windows user.
- Ciphertext is stored in the `providers.api_key_enc` BLOB.
- Decryption happens only inside the main process immediately before a provider request.
- DTOs expose `hasKey` and a masked hint such as `••••abcd`; they never expose the key.
- If DPAPI is unavailable, saving a key fails closed with a configuration error.
- Keys are never written to logs, exported data, tool arguments, or conversation content by IGRIS itself.
- Removing a provider deletes its ciphertext. Removing a stored key clears the blob.

**Caveat:** DPAPI protects data at rest against another Windows account and casual disk inspection. It does not protect against malware or a process running as the same logged-in user. A user who can run code as you can generally decrypt your DPAPI secrets.

## Permissions and approvals

Ten capabilities are **off by default**:

`filesystem`, `fileWrite`, `projectWrite`, `terminal`, `appLaunch`, `browser`, `screen`, `voice`, `desktopControl`, `browserControl`.

A tool may run only when:

1. its required permission is granted;
2. its argument schema passes;
3. tool-specific policy passes (path, command, risk);
4. if it is sensitive and `confirmSensitiveActions` is on, the user approves that specific call;
5. the run has not been cancelled and the tool timeout has not expired.

Approvals expire after two minutes. Pending approvals are rejected when the run is cancelled or the app shuts down. Every request, decision, result, and failure is written to the task/tool audit tables.

**Important:** approvals are a policy layer, not a security boundary against a malicious model. A user can disable `confirmSensitiveActions`, and a user can approve a harmful action. Read each preview. Grant the narrowest capability you need, and revoke capabilities when finished.

## Filesystem boundary

`WorkspaceBoundary` enforces:

- only explicitly approved workspace roots;
- lexical containment (`..` and absolute paths rejected);
- real-path containment, so a symlink or NTFS junction cannot escape;
- null-byte and drive-letter rejection;
- a nearest-existing-ancestor check for new paths;
- case-insensitive path semantics on Windows.

File operations additionally:

- skip dependency/build/cache directories during scans;
- cap scanned files, read sizes, search hits, and output;
- refuse binary previews;
- create timestamped backups before overwriting, patching, renaming, or deleting;
- send deletes to the Windows Recycle Bin via `shell.trashItem` when possible.

**Caveat:** adding a folder grants access to everything inside it, including `.env` files, keys, and personal documents. IGRIS does not classify file sensitivity. Add only project directories you are willing to expose to the assistant when the read permission is on.

## Terminal policy

Commands are tokenized without a shell. Shell metacharacters (`; & | < > \` $ ^ % !` and newlines) are rejected, so command chaining and expansion are not available. The executable must be on a fixed allowlist of development tools. Specific operations are blocked:

- `git push`, `git reset --hard`, `git clean -f`, `git filter-branch`, reflog expiry;
- `npm publish`, `npm login`, `npm adduser`, `npm token`, `npm logout`;
- executables outside the allowlist.

Risk levels are raised for dependency installs, `npx`, package scripts, and git state changes. Output is capped and redacted.

**Caveat:** an allowlist is risk reduction, not a sandbox. Allowed tools can still execute arbitrary code: `node -e`, `npm run <script>`, test runners loading project config, `git` hooks, compilers, and package install scripts. Only enable the terminal permission for repositories you trust, and keep per-call confirmation on.

## Desktop and browser control

Desktop control is a separate, task-scoped capability. It is never enabled implicitly by `screen`, `appLaunch`, or `browser`.

- The model must call `request_computer_control` and the user must approve that task. The approval always prompts, even when `confirmSensitiveActions` is off.
- A session is bound to one task ID, expires after 20 minutes, allows at most 120 actions, and ends when the task finishes, fails, is cancelled, or the user stops it.
- Scope is enforced in the main process: a desktop-only session cannot use the managed browser, and a browser-only session cannot use the desktop.
- `Ctrl+Alt+Shift+X` stops control globally. The shortcut is registered only while a session is active. The HUD and the Home control strip expose Pause, Resume, and Stop.
- Stop cancels the run, ends the session, hides the HUD, releases held keys and mouse buttons, and closes the managed browser.
- Every `desktop` and `browser` call is recorded as a tool run with its arguments, result, timing, and approval state.

### Hard blocks (never allowed, no prompt)

- Password fields (`IsPassword` / `input[type=password]`); IGRIS must never type credentials.
- UAC, secure desktop, `consent.exe`, `LogonUI.exe`, and Windows-reserved chords such as `Ctrl+Alt+Delete`.
- Higher-integrity/elevated windows; `SendInput` is subject to UIPI, so IGRIS refuses rather than clicking blindly.
- IGRIS’s own windows and process, to prevent self-control loops and prompt manipulation.
- Known credential managers (`1Password`, `Bitwarden`, `KeePass`, `LastPass`, `Dashlane`).
- Browser `file://`, `javascript:`, and `data:` URLs, plus downloads and uploads in the managed browser.

### Always-confirm actions

- Closing a window or app, including `Alt+F4`.
- Typing into a shell or terminal window, because it can bypass the terminal allowlist. The existing allowlist still governs IGRIS’s own `run_command`.
- Launching an app for the first time in a session.
- Clicking or pressing Enter on a checkout/payment/message-send pattern.

### Managed browser boundary

- The managed browser is a dedicated persistent Edge profile at `<userData>/browser/igris-profile`, with Chrome as fallback. It is not the user’s daily profile and does not inherit its sessions.
- The user can watch the browser and sign in manually; IGRIS does not type passwords.
- Page text, DOM, screenshots, and window titles are untrusted data. Instructions found on a page cannot change scope, permissions, or the goal.
- Downloads and uploads are blocked in v1.

**Caveat:** control is a policy layer, not a sandbox. An approved model can still operate any unelevated app and read anything visible on screen. Approve narrowly, watch the HUD, and stop when the task is done.

## Screen and voice

- Screen vision is explicit, permissioned, and saves only to the app's data directory.
- Voice input (microphone transcription via your cloud provider) is gated by the `voice` permission and off by default.
- Neither capability can be invoked by the minimized launcher; both require the main window.
- Captured screenshots can contain sensitive information and are not automatically redacted. Delete them when no longer needed.

## User browser vs managed browser

- IGRIS does not embed the user’s daily browser. `browser_open`, `browser_search`, and `youtube_search` only validate a URL and pass it to `shell.openExternal`.
- Only HTTP and HTTPS URLs are accepted; credentials embedded in URLs are rejected.
- Without a control session, IGRIS has no view of Chrome or Edge: it cannot read page text, click, fill forms, control playback, or verify what the page did.
- With a `browser` control session, IGRIS drives only its dedicated managed profile, never the user’s default profile.

**Caveat:** without page access, IGRIS cannot verify anything. It cannot confirm a page loaded, that a search succeeded, or that nothing was submitted. Ask the user to confirm anything important, and never assume a page matches what the model predicted.

## Logging and redaction

- The logger redacts provider keys, GitHub/Slack tokens, bearer tokens, labelled secrets, and token query parameters before writing.
- Tool output is redacted and truncated before persistence and display.
- Diagnostic export is built from the local database and redacted again at the boundary.
- Logging is controlled by **Settings → Privacy & data → Diagnostics**.
- No telemetry, crash reporting, or analytics leaves the machine.

**Caveat:** pattern-based redaction is best-effort. Unusual secret formats, secrets split across lines, or secrets in images may not be detected. Avoid pasting secrets into chat.

## Network behavior

IGRIS makes network requests only to:

- the provider base URL you configure (HTTPS; HTTP only for localhost);
- pages opened by `shell.openExternal` in your default browser, requested but never observed by IGRIS;
- pages visited by the managed IGRIS browser during an approved `browser` control session;
- provider documentation/model-list endpoints for the provider you select.

There is no IGRIS backend, account system, update service, or telemetry endpoint. DNS and TLS are handled by Electron/Chromium. A compromised provider can observe what you send to it; that is outside IGRIS's control.

## Local data protection

- The SQLite database, backups, screenshots, logs, operator script, and managed browser profile are protected by normal Windows file ACLs under `%APPDATA%\IGRIS`.
- There is no application-level database encryption. Anyone who can read your Windows profile can read the database (but not decrypt provider keys without DPAPI access as your user).
- Backups are copies of project files and inherit their sensitivity.
- The managed browser profile contains its own cookies, history, and cached pages. It is separate from your daily browser but still readable by anything running as your Windows user.
- Conversation retention can be set, and history can be cleared from Settings.

## Supply chain and packaging

- Dependencies are pinned in `package-lock.json`.
- `npm run dist` produces an unsigned NSIS installer. No code-signing certificate is configured in this repository.
- Verify the source and build locally before distributing. Sign the executable with your organization's certificate for production use.
- The packaged app uses an ASAR archive, but ASAR is not a security boundary.

## Reporting a vulnerability

Do not open a public GitHub issue containing secrets, personal paths, or conversation content. Contact the repository owner privately with:

- affected version/commit;
- reproduction steps;
- impact assessment;
- whether a secret or personal data was exposed.

Rotate any exposed API key immediately in the provider console and remove it from IGRIS.

## Explicit non-goals

IGRIS does **not** claim to:

- sandbox arbitrary terminal commands or untrusted repositories;
- prevent a user from approving a destructive action;
- prevent an approved control session from operating any unelevated app;
- protect against malware running as the same Windows user;
- provide anonymity, content filtering, or safe browsing;
- make a hostile model safe;
- encrypt the local database;
- replace backups or version control.
