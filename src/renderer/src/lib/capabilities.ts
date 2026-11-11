import type { PermissionKey, ToolInfo } from '@shared/types'

export interface CapabilityDefinition {
  key: string
  label: string
  short: string
  description: string
  permissions: PermissionKey[]
  toolIds: string[]
}

/** Capability groups shown in the terminal and on the Tools page. */
export const CAPABILITY_GROUPS: CapabilityDefinition[] = [
  {
    key: 'projects',
    label: 'Project inspection',
    short: 'Projects',
    description: 'List approved folders, map structure and create checkpoints.',
    permissions: ['filesystem'],
    toolIds: ['list_projects', 'inspect_project', 'create_checkpoint']
  },
  {
    key: 'files',
    label: 'Files',
    short: 'Files',
    description: 'Read, search, create, rename and remove files inside approved roots.',
    permissions: ['filesystem'],
    toolIds: ['read_file', 'search_files', 'create_entry', 'rename_entry', 'delete_entry']
  },
  {
    key: 'coding',
    label: 'Coding actions',
    short: 'Code',
    description: 'Write code, apply precise patches and run project tests.',
    permissions: ['fileWrite'],
    toolIds: ['write_file', 'apply_patch', 'run_tests']
  },
  {
    key: 'terminal',
    label: 'Terminal',
    short: 'Terminal',
    description: 'Run allowlisted developer commands with per-call approval.',
    permissions: ['terminal'],
    toolIds: ['run_command']
  },
  {
    key: 'apps',
    label: 'App launch',
    short: 'Apps',
    description: 'List and launch fixed desktop applications.',
    permissions: ['appLaunch'],
    toolIds: ['list_apps', 'launch_app']
  },
  {
    key: 'screen',
    label: 'Screen vision',
    short: 'Vision',
    description: 'Read open windows and capture the current desktop.',
    permissions: ['screen'],
    toolIds: ['list_windows', 'see_screen']
  },
  {
    key: 'browser',
    label: 'Browser handoff',
    short: 'Browser',
    description: 'Open pages and searches in your default browser.',
    permissions: ['browser'],
    toolIds: ['browser_open', 'browser_search', 'youtube_search']
  },
  {
    key: 'desktop-control',
    label: 'Computer control',
    short: 'Control',
    description:
      'See the screen and operate apps with the mouse and keyboard, one explicitly approved task at a time.',
    permissions: ['desktopControl', 'screen'],
    toolIds: ['request_computer_control', 'desktop']
  },
  {
    key: 'browser-control',
    label: 'Managed browser',
    short: 'Web AI',
    description:
      'Drive a dedicated IGRIS Edge profile to navigate, read and operate web pages without touching your normal browser.',
    permissions: ['browserControl'],
    toolIds: ['browser']
  },
  {
    key: 'voice',
    label: 'Voice',
    short: 'Voice',
    description: 'Transcribe microphone input through the default Gemini provider.',
    permissions: ['voice'],
    toolIds: []
  },
  {
    key: 'memory',
    label: 'Memory',
    short: 'Memory',
    description: 'Save and recall durable facts, preferences and instructions.',
    permissions: [],
    toolIds: ['save_memory', 'search_memories']
  },
  {
    key: 'system',
    label: 'System',
    short: 'System',
    description: 'Read local runtime facts without touching external services.',
    permissions: [],
    toolIds: ['current_time']
  }
]

export function capabilityForTool(toolId: string): CapabilityDefinition | null {
  return CAPABILITY_GROUPS.find((group) => group.toolIds.includes(toolId)) ?? null
}

export function toolsForCapability(group: CapabilityDefinition, tools: ToolInfo[]): ToolInfo[] {
  return group.toolIds
    .map((id) => tools.find((tool) => tool.id === id))
    .filter((tool): tool is ToolInfo => Boolean(tool))
}

export function capabilityPermissionOn(
  group: CapabilityDefinition,
  permissions: Record<PermissionKey, boolean> | undefined
): boolean {
  if (!group.permissions.length) return true
  return group.permissions.every((key) => Boolean(permissions?.[key]))
}
