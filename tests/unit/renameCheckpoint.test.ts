import { describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from '../../src/main/tools/registry'

function makeRegistry(files: {
  backupFile: (workspaceId: string, path: string) => string
  rename: (workspaceId: string, from: string, to: string) => void
}) {
  return createToolRegistry({
    workspaces: { list: () => [{ id: 'ws1', name: 'IGRIS', path: 'C:\\Projects\\igris' }] },
    files,
    terminal: {},
    apps: { list: () => [] },
    screen: { status: () => ({ available: false, detail: '' }) },
    browser: {},
    control: {},
    desktop: {},
    managedBrowser: {},
    memories: { list: () => [], add: () => ({ id: 'm1' }) },
    tasks: { savePlan: () => undefined },
    settings: () => ({}) as never,
    logger: { warn: () => undefined, info: () => undefined }
  } as never)
}

const CONTEXT = {
  taskId: 'task-1',
  signal: new AbortController().signal,
  confirm: async () => true
}

describe('rename_entry auto-checkpoint', () => {
  it('checkpoints the source file before renaming and reports it', async () => {
    const rename = vi.fn()
    const backupFile = vi.fn(() => 'C:\\backups\\checkpoint-1\\a.ts')
    const registry = makeRegistry({ backupFile, rename })

    const outcome = await registry.get('rename_entry')!.run({ from: 'a.ts', to: 'b.ts' }, CONTEXT)
    expect(backupFile).toHaveBeenCalledWith('ws1', 'a.ts')
    expect(rename).toHaveBeenCalledWith('ws1', 'a.ts', 'b.ts')
    expect(outcome.text).toContain('Checkpoint of the original saved')
  })

  it('renames even when the item cannot be checkpointed (directories)', async () => {
    const rename = vi.fn()
    const backupFile = vi.fn(() => {
      throw new Error('Only files can be checkpointed.')
    })
    const registry = makeRegistry({ backupFile, rename })

    const outcome = await registry.get('rename_entry')!.run({ from: 'src', to: 'source' }, CONTEXT)
    expect(rename).toHaveBeenCalledWith('ws1', 'src', 'source')
    expect(outcome.text).not.toContain('Checkpoint')
  })
})
