import {
  app,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray
} from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  IPC_CHAT_EVENT,
  IPC_TASK_EVENT
} from '@shared/ipc'
import type { ChatEvent, Settings } from '@shared/types'
import { Database } from './storage/database'
import {
  ConversationRepository,
  LogRepository,
  MemoryRepository,
  ProviderRepository,
  SettingsRepository,
  TaskRepository,
  WorkspaceRepository,
  buildExportBundle
} from './storage/repositories'
import { SettingsService } from './services/settingsService'
import { Logger } from './services/logger'
import { CredentialStore } from './security/credentials'
import { ProviderService } from './services/providerService'
import { FileService } from './services/fileService'
import { TerminalService } from './services/terminalService'
import { AppService } from './services/appService'
import { ScreenService } from './services/screenService'
import { VoiceService } from './services/voiceService'
import { BrowserService } from './services/browserService'
import { TaskService } from './tasks/taskService'
import { createToolRegistry } from './tools/registry'
import { ToolRuntime } from './tools/toolRuntime'
import { ControlSessionService } from './control/sessionService'
import { OperatorClient } from './control/operatorClient'
import { DesktopService } from './control/desktopService'
import { BrowserService as ControlBrowserService } from './control/browserService'
import { encodeScreenshotBuffer, encodeScreenshotFile } from './control/screenshotEncoder'
import { ChatEngine } from './ai/chatEngine'
import { MainWindowManager } from './windows/mainWindow'
import { MiniLauncherManager } from './windows/miniWindow'
import { createIpcDispatcher, type AppContext } from './ipc'
import { TRAY_ICON_PNG } from './trayIcon'

const startedAt = new Date().toISOString()
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const e2e = Boolean(process.env.IGRIS_E2E)
let db: Database | null = null
let tray: Tray | null = null
let mainWindow: MainWindowManager | null = null
let miniLauncher: MiniLauncherManager | null = null
let operatorClient: OperatorClient | null = null
let desktopControl: DesktopService | null = null
let browserControl: ControlBrowserService | null = null
let controlSession: ControlSessionService | null = null
let chat: ChatEngine | null = null
let settingsService: SettingsService | null = null
let conversations: ConversationRepository | null = null
let logger: Logger | null = null
let dispatcherChannel: string | null = null
let shuttingDown = false
let finished = false

app.setName('IGRIS')

const customUserData = process.env.IGRIS_USER_DATA
if (customUserData) {
  mkdirSync(customUserData, { recursive: true })
  app.setPath('userData', customUserData)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    mainWindow?.show()
  })
  void start()
}

async function start(): Promise<void> {
  await app.whenReady()
  app.setAppUserModelId('dev.igris.assistant')
  applyCsp()
  denyDefaultSessionPermissions()

  try {
    await boot()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      'IGRIS could not start',
      `The local core failed to initialize.\n\n${message}\n\nNo data was sent anywhere.`
    )
    app.quit()
  }

  app.on('activate', () => {
    mainWindow?.show()
  })
  app.on('window-all-closed', () => {
    // IGRIS lives in the tray; quitting is explicit.
  })
  app.on('before-quit', (event) => {
    if (finished) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    try {
      mainWindow?.setQuitting(true)
      miniLauncher?.setQuitting(true)
      chat?.cancelAll('shutdown')
      miniLauncher?.close()
      try {
        void desktopControl?.releaseAll()
        void browserControl?.stop()
        controlSession?.endAll('app quit')
      } catch {
        // Control shutdown is best effort.
      }
    } catch {
      // Continue shutdown even if a window is already gone.
    }
    setTimeout(() => {
      try {
        if (settingsService && conversations && !settingsService.get().privacy.saveConversations) {
          conversations.clearAll()
        }
      } catch {
        // A closed database must not block shutdown.
      }
      try {
        db?.close()
        db = null
      } catch {
        // The database may already be closed.
      }
      finished = true
      app.quit()
    }, 300)
  })
  app.on('will-quit', () => {
    if (dispatcherChannel) ipcMain.removeHandler(dispatcherChannel)
    operatorClient?.dispose()
    tray?.destroy()
    tray = null
  })
}

async function boot(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const dataDir = join(userDataPath, 'data')
  const backupsDir = join(dataDir, 'backups')
  const screenshotsDir = join(dataDir, 'screenshots')
  const controlScreenshotsDir = join(dataDir, 'control')
  const operatorDir = join(userDataPath, 'operator')
  const browserProfileDir = join(userDataPath, 'browser', 'igris-profile')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(backupsDir, { recursive: true })
  mkdirSync(screenshotsDir, { recursive: true })
  mkdirSync(controlScreenshotsDir, { recursive: true })
  mkdirSync(operatorDir, { recursive: true })

  db = new Database(join(dataDir, 'igris.db'))
  const database = db
  const settingsRepo = new SettingsRepository(database)
  const providerRepo = new ProviderRepository(database)
  const conversationRepo = new ConversationRepository(database)
  const taskRepo = new TaskRepository(database)
  const workspaceRepo = new WorkspaceRepository(database)
  const memoryRepo = new MemoryRepository(database)
  const logRepo = new LogRepository(database)

  const settings = new SettingsService(settingsRepo)
  settingsService = settings
  const appLogger = new Logger(logRepo, () => settings.get().privacy.diagnostics, isDev)
  logger = appLogger
  const credentials = new CredentialStore()
  const providers = new ProviderService(providerRepo, credentials, appLogger)
  const voice = new VoiceService(providers, appLogger)
  const roles = new Map<number, 'main' | 'mini'>()

  const main = new MainWindowManager(roles, settings, appLogger)
  mainWindow = main

  const mini = new MiniLauncherManager(roles, appLogger)
  miniLauncher = mini
  main.setMinimizeListener((minimized) => {
    if (minimized) mini.show()
    else mini.hide()
  })

  const browserService = new BrowserService(appLogger)

  const files = new FileService(workspaceRepo, backupsDir)
  const terminal = new TerminalService(workspaceRepo, appLogger)
  const apps = new AppService()
  const screen = new ScreenService(screenshotsDir)
  const control = new ControlSessionService(undefined, undefined)
  controlSession = control

  const operatorPath = join(operatorDir, 'operator.ps1')
  const bundledOperator = join(__dirname, 'operator.ps1')
  const sourceOperator = existsSync(bundledOperator)
    ? bundledOperator
    : join(process.cwd(), 'src', 'main', 'control', 'operator.ps1')
  try {
    copyFileSync(sourceOperator, operatorPath)
  } catch (error) {
    appLogger.warn(
      'control',
      `The Windows operator script could not be installed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  const operator = new OperatorClient({
    logger: appLogger,
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      operatorPath
    ],
    cwd: operatorDir
  })
  const desktopControlService = new DesktopService({
    operator,
    sessions: control,
    apps,
    logger: appLogger,
    screenshotsDir: controlScreenshotsDir,
    encodeScreenshot: async (path) => encodeScreenshotFile(path),
    openPath: (path) => shell.openPath(path),
    self: { pid: process.pid, processName: 'igris' }
  })
  const browserControlService = new ControlBrowserService({
    sessions: control,
    profileDir: browserProfileDir,
    logger: appLogger,
    encodeScreenshot: async (buffer) => encodeScreenshotBuffer(buffer)
  })
  operatorClient = operator
  desktopControl = desktopControlService
  browserControl = browserControlService

  const tasks = new TaskService(taskRepo, (taskId) => {
    main.send(IPC_TASK_EVENT, { type: 'changed', taskId })
  })
  const tools = createToolRegistry({
    workspaces: workspaceRepo,
    files,
    terminal,
    apps,
    screen,
    browser: browserService,
    memories: memoryRepo,
    settings: () => settings.get(),
    logger: appLogger
  })
  const toolRuntime = new ToolRuntime(
    (id) => tools.get(id),
    tasks,
    () => settings.get(),
    appLogger
  )

  const emitChat = (event: ChatEvent): void => {
    main.send(IPC_CHAT_EVENT, event)
  }

  const chatEngine = new ChatEngine({
    conversations: conversationRepo,
    memories: memoryRepo,
    workspaces: workspaceRepo,
    tasks,
    providers,
    settings,
    tools,
    toolRuntime,
    logger: appLogger,
    emit: emitChat
  })
  chat = chatEngine

  const context: AppContext = {
    version: app.getVersion(),
    startedAt,
    userDataPath,
    roles,
    db: database,
    settings,
    logger: appLogger,
    credentials,
    providers,
    conversations: conversationRepo,
    memories: memoryRepo,
    workspaces: workspaceRepo,
    logs: logRepo,
    tasks,
    chat: chatEngine,
    tools,
    files,
    terminal,
    apps,
    screen,
    voice,
    control,
    desktop: desktopControlService,
    browserControl: browserControlService,
    operator,
    mainWindow: main,
    exportBundle: buildExportBundle
  }
  const dispatcher = createIpcDispatcher(context)
  dispatcherChannel = dispatcher.channel
  ipcMain.handle(dispatcher.channel, dispatcher.handler)

  tasks.markInterrupted()
  const retention = settings.get().privacy.retentionDays
  if (retention > 0) {
    const cutoff = new Date(Date.now() - retention * 86_400_000).toISOString()
    const removed = conversationRepo.pruneOlderThan(cutoff)
    if (removed) appLogger.info('privacy', `Pruned ${removed} conversations older than ${retention} days.`)
  }

  let previousDesktop = settings.get().desktop
  settings.on('changed', (next: Settings) => {
    try {
      if (next.desktop.launchAtStartup !== previousDesktop.launchAtStartup) {
        applyStartup(next.desktop.launchAtStartup)
      }
      previousDesktop = next.desktop
    } catch (error) {
      appLogger.warn('settings', `Desktop settings could not be applied: ${String(error)}`)
    }
  })

  applyStartup(settings.get().desktop.launchAtStartup)

  main.show('/')
  createTray(main)
  appLogger.info(
    'core',
    `IGRIS ${app.getVersion()} started on Electron ${process.versions.electron}; data at ${dataDir}.`
  )
  if (e2e) appLogger.info('core', 'Running in automated test mode.')
}

function createTray(
  main: MainWindowManager
): void {
  try {
    const image = nativeImage
      .createFromBuffer(Buffer.from(TRAY_ICON_PNG, 'base64'))
      .resize({ width: 16, height: 16 })
    tray = new Tray(image)
    tray.setToolTip('IGRIS — personal AI assistant')
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open IGRIS',
        click: () => main.show('/')
      },
      {
        label: 'New conversation',
        click: () => main.show('/chat')
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => main.show('/settings')
      },
      { type: 'separator' },
      {
        label: 'Quit IGRIS',
        click: () => app.quit()
      }
    ])
    tray.setContextMenu(menu)
    tray.on('click', () => main.show('/'))
    tray.on('double-click', () => main.show('/'))
  } catch (error) {
    logger?.warn('tray', `The system tray icon could not be created: ${String(error)}`)
  }
}

function applyStartup(enabled: boolean): void {
  try {
    if (!app.isPackaged) {
      if (enabled) {
        logger?.info('startup', 'Launch-at-startup is ignored in development builds.')
      }
      return
    }
    app.setLoginItemSettings({ openAtLogin: enabled })
    logger?.info('startup', `Launch at Windows startup ${enabled ? 'enabled' : 'disabled'}.`)
  } catch (error) {
    logger?.warn('startup', `Windows startup settings could not be updated: ${String(error)}`)
  }
}

function applyCsp(): void {
  if (isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-src 'none'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'"
        ],
        'X-Content-Type-Options': ['nosniff']
      }
    })
  })
}

function denyDefaultSessionPermissions(): void {
  try {
    // Deny everything except microphone capture, which the Conversation page
    // needs for voice transcription. The IGRIS-level "Voice input" permission
    // gates whether the mic button is offered at all.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission === 'media')
    )
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'media')
  } catch {
    // Permission APIs are unavailable on some Windows configurations.
  }
}

process.on('uncaughtException', (error) => {
  console.error('[IGRIS] Uncaught exception:', error)
  logger?.error('core', `Uncaught exception: ${error.message}`)
})
process.on('unhandledRejection', (reason) => {
  console.error('[IGRIS] Unhandled rejection:', reason)
  logger?.error('core', `Unhandled rejection: ${String(reason)}`)
})
