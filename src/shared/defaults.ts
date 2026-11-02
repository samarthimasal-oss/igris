import type { PermissionKey, ProviderKind, Settings } from './types'

export const APP_NAME = 'IGRIS'
export const APP_VERSION = '1.0.0'

export const DEFAULT_SETTINGS: Settings = {
  appearance: {
    accent: 'azure',
    reducedMotion: false,
    animationIntensity: 'balanced',
    quality: 'high',
    show3d: true
  },
  desktop: {
    launchAtStartup: false,
    closeToTray: false
  },
  permissions: {
    filesystem: false,
    fileWrite: false,
    projectWrite: false,
    terminal: false,
    appLaunch: false,
    browser: false,
    screen: false,
    voice: false
  },
  privacy: {
    diagnostics: true,
    retentionDays: 0,
    saveConversations: true
  },
  ai: {
    contextMessages: 24,
    maxToolIterations: 6,
    temperature: 0.7,
    streaming: true,
    systemInstructions: '',
    confirmSensitiveActions: true
  },
  onboardingComplete: false
}

export interface ProviderCatalogEntry {
  kind: ProviderKind
  label: string
  shortLabel: string
  description: string
  defaultBaseUrl: string
  requiresKey: boolean
  allowsCustomBaseUrl: boolean
  modelListSupport: boolean
  toolSupport: 'native' | 'configurable'
  docsUrl: string
  placeholderModel: string
  authNote: string
}

export const PROVIDER_CATALOG: Record<ProviderKind, ProviderCatalogEntry> = {
  openai: {
    kind: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    description: 'GPT models through the OpenAI platform API.',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    allowsCustomBaseUrl: true,
    modelListSupport: true,
    toolSupport: 'native',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    placeholderModel: 'Enter or fetch a model ID',
    authNote: 'API usage is billed by OpenAI according to your account.'
  },
  anthropic: {
    kind: 'anthropic',
    label: 'Anthropic',
    shortLabel: 'Anthropic',
    description: 'Claude models through the Anthropic Messages API.',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresKey: true,
    allowsCustomBaseUrl: false,
    modelListSupport: true,
    toolSupport: 'native',
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
    placeholderModel: 'Enter or fetch a Claude model ID',
    authNote: 'API usage is billed by Anthropic according to your account.'
  },
  gemini: {
    kind: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    description: 'Gemini models through the Google Generative Language API.',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresKey: true,
    allowsCustomBaseUrl: false,
    modelListSupport: true,
    toolSupport: 'native',
    docsUrl: 'https://ai.google.dev/api',
    placeholderModel: 'Enter or fetch a Gemini model ID',
    authNote: 'Quotas and billing depend on your Google AI account.'
  },
  openrouter: {
    kind: 'openrouter',
    label: 'OpenRouter Free',
    shortLabel: 'OpenRouter',
    description: 'Free models only, routed through OpenRouter’s OpenAI-compatible API.',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    allowsCustomBaseUrl: false,
    modelListSupport: true,
    toolSupport: 'configurable',
    docsUrl: 'https://openrouter.ai/docs/quickstart',
    placeholderModel: 'e.g. google/gemma-4-31b-it:free',
    authNote:
      'Free models are rate-limited and may require enabling prompt logging in your OpenRouter privacy settings.'
  },
  opencode: {
    kind: 'opencode',
    label: 'OpenCode Console',
    shortLabel: 'OpenCode',
    description:
      'Claude, GPT, Gemini and open coding models through one OpenCode Console key.',
    defaultBaseUrl: 'https://opencode.ai/inference/openai/v1',
    requiresKey: true,
    allowsCustomBaseUrl: true,
    modelListSupport: true,
    toolSupport: 'native',
    docsUrl: 'https://opencode.ai/v2/docs/console/api/inference/',
    placeholderModel: 'Enter or fetch an OpenCode model ID',
    authNote: 'Usage is billed through your OpenCode Console balance or Go plan.'
  },
  'openai-compatible': {
    kind: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    shortLabel: 'Compatible',
    description: 'A remote endpoint implementing the OpenAI chat completions API.',
    defaultBaseUrl: '',
    requiresKey: false,
    allowsCustomBaseUrl: true,
    modelListSupport: true,
    toolSupport: 'configurable',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    placeholderModel: 'Enter the model ID exposed by your endpoint',
    authNote: 'The endpoint may require its own key and may charge for usage.'
  }
}

export const PROVIDER_ORDER: ProviderKind[] = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'opencode',
  'openai-compatible'
]

export const PERMISSION_META: Record<
  PermissionKey,
  { label: string; description: string; sensitive: boolean }
> = {
  filesystem: {
    label: 'Read approved projects',
    description: 'List, preview and search files inside project folders you add to IGRIS.',
    sensitive: false
  },
  fileWrite: {
    label: 'Modify files',
    description: 'Create, edit, rename or move files inside approved folders. Writes create a backup.',
    sensitive: true
  },
  projectWrite: {
    label: 'Coding agent actions',
    description: 'Run project tests and create checkpoints for code changes.',
    sensitive: true
  },
  terminal: {
    label: 'Run terminal commands',
    description: 'Execute allowlisted development commands inside an approved project.',
    sensitive: true
  },
  appLaunch: {
    label: 'Launch applications',
    description: 'Start applications from a verified, built-in list.',
    sensitive: true
  },
  browser: {
    label: 'Web browsing',
    description:
      'Let the assistant open pages and searches in your default browser. IGRIS cannot read or control Chrome or Edge.',
    sensitive: true
  },
  screen: {
    label: 'See my screen',
    description:
      'Let IGRIS look at your desktop — everything visible, including background windows — when you ask it to.',
    sensitive: true
  },
  voice: {
    label: 'Voice input',
    description:
      'Let IGRIS use your microphone and transcribe speech with your cloud provider. Audio is used only for transcription.',
    sensitive: true
  }
}

export const CLI_ENV_NOTE =
  'API keys are stored with Windows DPAPI and are never written to logs or sent to the interface.'
