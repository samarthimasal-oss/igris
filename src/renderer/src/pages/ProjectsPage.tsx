import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  Code2,
  File,
  FileDiff,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import type {
  FileHit,
  FilePreview,
  ProjectScan,
  TreeNode,
  Workspace
} from '@shared/types'
import { useAppStore } from '../lib/store'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Spinner
} from '../components/ui'
import { errorHint, errorMessage } from '../lib/errors'
import { buildDiff } from '../lib/diff'
import { formatBytes, languageLabel, plural } from '../lib/format'
import clsx from 'clsx'

interface ConsoleLine {
  id: number
  at: number
  text: string
  tone: 'info' | 'success' | 'warning' | 'danger'
}

type PendingAction =
  | { type: 'create'; kind: 'file' | 'dir'; value: string }
  | { type: 'rename'; from: string; value: string }
  | { type: 'delete-file'; path: string }
  | { type: 'remove-project'; id: string; name: string }
  | null

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect
}: {
  node: TreeNode
  depth: number
  selectedPath: string | null
  onSelect: (node: TreeNode) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  if (node.type === 'dir') {
    return (
      <div className="tree-branch">
        <button
          type="button"
          className={clsx('tree-row', 'is-dir', selectedPath === node.path && 'is-selected')}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {open ? <FolderOpen size={13} className="tree-icon-folder" /> : <Folder size={13} className="tree-icon-folder" />}
          <span>{node.name}</span>
        </button>
        {open && node.children?.length ? (
          <div className="tree-children">
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={clsx('tree-row', selectedPath === node.path && 'is-selected')}
      style={{ paddingLeft: 22 + depth * 14 }}
      onClick={() => onSelect(node)}
      title={node.path}
    >
      <File size={12} className="tree-icon-file" />
      <span>{node.name}</span>
    </button>
  )
}

async function scanWorkspace(id: string): Promise<ProjectScan> {
  if (!window.igris) throw new Error('The IGRIS bridge is unavailable.')
  return window.igris.projects.scan(id)
}

export function ProjectsPage() {
  const workspaces = useAppStore((state) => state.workspaces)
  const settings = useAppStore((state) => state.settings)
  const preferredWorkspaceId = useAppStore((state) => state.preferredWorkspaceId)
  const setPreferredWorkspace = useAppStore((state) => state.setPreferredWorkspace)
  const refreshWorkspaces = useAppStore((state) => state.refreshWorkspaces)
  const notify = useAppStore((state) => state.notify)
  const navigate = useNavigate()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scan, setScan] = useState<ProjectScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<FileHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [action, setAction] = useState<PendingAction>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const preferredApplied = useRef(false)
  const consoleId = useRef(0)

  const canRead = settings?.permissions.filesystem ?? false
  const canWrite = settings?.permissions.fileWrite ?? false
  const workspace = workspaces.find((item) => item.id === selectedId) ?? null

  const log = (text: string, tone: ConsoleLine['tone'] = 'info'): void => {
    consoleId.current += 1
    const entry: ConsoleLine = { id: consoleId.current, at: Date.now(), text, tone }
    setConsoleLines((current) => [...current.slice(-7), entry])
  }

  const selectProject = (id: string | null): void => {
    setSelectedId(id)
    setPreferredWorkspace(id)
  }

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  useEffect(() => {
    if (!workspaces.length) {
      setSelectedId(null)
      return
    }
    const preferred =
      preferredWorkspaceId && workspaces.some((item) => item.id === preferredWorkspaceId)
        ? preferredWorkspaceId
        : null
    if (preferred && !preferredApplied.current) {
      preferredApplied.current = true
      setSelectedId(preferred)
      return
    }
    if (!selectedId || !workspaces.some((item) => item.id === selectedId)) {
      setSelectedId(workspaces[0]?.id ?? null)
    }
  }, [workspaces, selectedId, preferredWorkspaceId])

  const runScan = async (id: string): Promise<void> => {
    setScanning(true)
    setScanError(null)
    try {
      const result = await scanWorkspace(id)
      setScan(result)
      log(`scan complete · ${result.files} files · ${result.directories} folders`, 'success')
    } catch (error) {
      setScan(null)
      const message = `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim()
      setScanError(message)
      log(`scan failed · ${message}`, 'danger')
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    if (!selectedId) {
      setScan(null)
      return
    }
    setSelectedPath(null)
    setPreview(null)
    setDraft('')
    setDirty(false)
    setHits(null)
    void runScan(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const openFile = async (path: string): Promise<void> => {
    if (!selectedId) return
    setPreviewLoading(true)
    try {
      const file = await window.igris.files.preview(selectedId, path)
      setSelectedPath(file.path)
      setPreview(file)
      setDraft(file.content)
      setDirty(false)
      setReviewOpen(false)
      log(`open · ${file.path}`, 'info')
    } catch (error) {
      const message = `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim()
      notify('error', 'Could not open file', message)
      log(`open failed · ${message}`, 'danger')
    } finally {
      setPreviewLoading(false)
    }
  }

  const saveFile = async (): Promise<void> => {
    if (!selectedId || !preview || preview.binary || !dirty) return
    setSaving(true)
    try {
      const result = await window.igris.files.write(selectedId, preview.path, draft)
      setPreview({ ...preview, content: draft, size: result.bytes })
      setDirty(false)
      setReviewOpen(false)
      log(`write · ${preview.path} · ${formatBytes(result.bytes)}`, 'success')
      notify(
        'success',
        'File saved',
        result.backupPath ? 'A timestamped backup was created before the write.' : undefined
      )
    } catch (error) {
      const message = `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim()
      notify('error', 'Could not save file', message)
      log(`write failed · ${message}`, 'danger')
    } finally {
      setSaving(false)
    }
  }

  const runSearch = async (): Promise<void> => {
    if (!selectedId) return
    if (!query.trim()) {
      setHits(null)
      return
    }
    setSearching(true)
    try {
      const results = await window.igris.files.search(selectedId, query.trim())
      setHits(results)
      log(`search · “${query.trim()}” · ${plural(results.length, 'match', 'matches')}`, 'info')
    } catch (error) {
      const message = `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim()
      notify('error', 'Search failed', message)
      log(`search failed · ${message}`, 'danger')
    } finally {
      setSearching(false)
    }
  }

  const confirmAction = async (): Promise<void> => {
    if (!action || !selectedId) return
    setActionBusy(true)
    try {
      if (action.type === 'create') {
        const value = action.value.trim()
        if (!value) return
        await window.igris.files.create(selectedId, value, action.kind)
        await runScan(selectedId)
        log(`create ${action.kind} · ${value}`, 'success')
        notify('success', action.kind === 'dir' ? 'Folder created' : 'File created', value)
        if (action.kind === 'file') await openFile(value)
      } else if (action.type === 'rename') {
        const value = action.value.trim()
        if (!value || value === action.from) return
        await window.igris.files.rename(selectedId, action.from, value)
        await runScan(selectedId)
        setPreview(null)
        setSelectedPath(null)
        await openFile(value)
        log(`rename · ${action.from} → ${value}`, 'success')
        notify('success', 'Item renamed')
      } else if (action.type === 'delete-file') {
        await window.igris.files.delete(selectedId, action.path)
        await runScan(selectedId)
        setPreview(null)
        setSelectedPath(null)
        setDraft('')
        setDirty(false)
        log(`recycle · ${action.path}`, 'warning')
        notify('success', 'Moved to Recycle Bin')
      } else if (action.type === 'remove-project') {
        await window.igris.projects.remove(action.id)
        await refreshWorkspaces()
        log(`unapprove · ${action.name} · files untouched`, 'warning')
        if (selectedId === action.id) {
          setSelectedId(null)
          setPreferredWorkspace(null)
          setScan(null)
          setPreview(null)
        }
        notify('success', 'Project removed from IGRIS', 'No files were deleted.')
      }
      setAction(null)
    } catch (error) {
      const message = `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim()
      notify('error', 'Action failed', message)
      log(`action failed · ${message}`, 'danger')
    } finally {
      setActionBusy(false)
    }
  }

  const addProject = async (): Promise<void> => {
    try {
      const added = await window.igris.projects.add()
      if (!added) return
      await refreshWorkspaces()
      selectProject(added.id)
      log(`approve · ${added.path}`, 'success')
      notify('success', 'Project approved', added.name)
    } catch (error) {
      const message = `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim()
      notify('error', 'Could not add project', message)
      log(`approve failed · ${message}`, 'danger')
    }
  }

  const openFolder = async (): Promise<void> => {
    if (!selectedId) return
    try {
      await window.igris.projects.openInExplorer(selectedId)
    } catch (error) {
      notify('error', 'Could not open folder', errorMessage(error))
    }
  }

  const revealSelected = async (): Promise<void> => {
    if (!selectedId || !selectedPath) return
    try {
      await window.igris.files.reveal(selectedId, selectedPath)
    } catch (error) {
      notify('error', 'Could not reveal file', errorMessage(error))
    }
  }

  const treeCount = useMemo(() => {
    if (!scan) return { files: 0, dirs: 0 }
    return { files: scan.files, dirs: scan.directories }
  }, [scan])

  const reviewDiff = useMemo(
    () => (preview && dirty && !preview.binary ? buildDiff(preview.content, draft) : null),
    [preview, draft, dirty]
  )

  const hasProject = Boolean(selectedId && workspace)
  const modalOpen = action?.type === 'create' || action?.type === 'rename'
  const actionTitle =
    action?.type === 'create'
      ? action.kind === 'dir'
        ? 'New folder'
        : 'New file'
      : action?.type === 'rename'
        ? 'Rename item'
        : ''
  const actionLabel =
    action?.type === 'create'
      ? action.kind === 'dir'
        ? 'Create folder'
        : 'Create file'
      : 'Rename'
  const actionValue = action && 'value' in action ? action.value : ''
  const removingProject = action?.type === 'remove-project' ? action : null

  return (
    <div className="page projects-page">
      <PageHeader
        eyebrow="// PROJECT WORKSPACE"
        title="Projects"
        description="Approved folders only. Inspect structure, search, preview and edit with guarded writes, automatic backups and an explicit diff review before every save."
        actions={
          <>
            <Button variant="ghost" icon={<FolderSearch size={15} />} onClick={() => navigate('/chat')}>
              Ask about code
            </Button>
            <Button variant="primary" icon={<FolderPlus size={15} />} onClick={() => void addProject()}>
              Add project
            </Button>
          </>
        }
      />

      <div className="project-status-strip">
        <span className="project-status-cell">
          <Folder size={11} />
          {plural(workspaces.length, 'approved root')}
        </span>
        <span className={clsx('project-status-cell', canRead ? 'is-live' : 'is-warn')}>
          <ShieldCheck size={11} />
          {canRead ? (canWrite ? 'read-write · backups on' : 'read-only preview') : 'filesystem off'}
        </span>
        <span className="project-status-path" title={workspace?.path}>
          <TerminalSquare size={11} />
          {workspace?.path ?? 'no active workspace'}
        </span>
      </div>

      {!canRead ? (
        <Alert
          tone="warning"
          title="Project reading is disabled"
          action={
            <Button variant="default" size="sm" onClick={() => navigate('/settings')}>
              Open permissions
            </Button>
          }
        >
          Enable “Read approved projects” in Settings → Permissions before opening a workspace.
        </Alert>
      ) : null}

      <div className="projects-layout">
        <aside className="project-rail">
          <div className="rail-heading">
            <span>Approved folders</span>
            <Badge tone="neutral">{workspaces.length}</Badge>
          </div>
          <div className="project-list">
            {workspaces.length ? (
              workspaces.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={clsx('project-item', item.id === selectedId && 'is-active')}
                  onClick={() => selectProject(item.id)}
                >
                  <span className="project-item-icon">
                    <Folder size={15} />
                  </span>
                  <span className="project-item-copy">
                    <strong>{item.name}</strong>
                    <small>{item.kind ?? 'Project folder'}</small>
                  </span>
                  {item.id === selectedId ? <span className="project-item-active" /> : null}
                </button>
              ))
            ) : (
              <div className="rail-empty">
                <FolderSearch size={20} />
                <p>No folders approved yet.</p>
                <Button size="sm" variant="default" onClick={() => void addProject()}>
                  Choose a folder
                </Button>
              </div>
            )}
          </div>

          {workspace ? (
            <Card className="project-detail">
              <div className="project-detail-name">{workspace.name}</div>
              <div className="project-detail-path" title={workspace.path}>
                {workspace.path}
              </div>
              <div className="project-detail-stats">
                <div>
                  <strong>{treeCount.files}</strong>
                  <span>files</span>
                </div>
                <div>
                  <strong>{treeCount.dirs}</strong>
                  <span>folders</span>
                </div>
              </div>
              {scan?.detected.length ? (
                <div className="project-tags">
                  {scan.detected.slice(0, 4).map((tag) => (
                    <Badge key={tag} tone="accent">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <div className="project-detail-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw size={13} />}
                  onClick={() => selectedId && void runScan(selectedId)}
                  loading={scanning}
                >
                  Rescan
                </Button>
                <Button variant="ghost" size="sm" icon={<FolderOpen size={13} />} onClick={() => void openFolder()}>
                  Reveal
                </Button>
              </div>
              <button
                type="button"
                className="danger-link"
                onClick={() =>
                  setAction({ type: 'remove-project', id: workspace.id, name: workspace.name })
                }
              >
                <Trash2 size={12} />
                Remove from IGRIS
              </button>
            </Card>
          ) : null}

          <div className="project-console">
            <div className="project-console-head">
              <TerminalSquare size={11} />
              <span>output</span>
            </div>
            {consoleLines.length ? (
              consoleLines.map((line) => (
                <p key={line.id} className={clsx('project-console-line', `is-${line.tone}`)}>
                  <span className="project-console-time">
                    {new Date(line.at).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </span>
                  <span>{line.text}</span>
                </p>
              ))
            ) : (
              <p className="project-console-line is-dim">waiting for workspace events…</p>
            )}
          </div>
        </aside>

        <section className="project-work">
          {!hasProject ? (
            <Card className="project-empty">
              <EmptyState
                icon={FolderSearch}
                title="Approve your first project"
                description="IGRIS only reads inside folders you explicitly add. Paths cannot escape the approved root."
                action={
                  <Button variant="primary" icon={<FolderPlus size={15} />} onClick={() => void addProject()}>
                    Choose a folder
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              <div className="project-toolbar">
                <div className="project-toolbar-copy">
                  <div className="eyebrow">Active workspace</div>
                  <div className="project-toolbar-title">
                    <h2>{workspace?.name}</h2>
                    {scan?.truncated ? <Badge tone="warning">Tree truncated</Badge> : null}
                  </div>
                  <p title={workspace?.path}>{workspace?.path}</p>
                </div>
                <div className="project-toolbar-actions">
                  <Button
                    variant="default"
                    size="sm"
                    icon={<FilePlus2 size={14} />}
                    onClick={() => setAction({ type: 'create', kind: 'file', value: '' })}
                    disabled={!canWrite}
                  >
                    New file
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    icon={<FolderPlus size={14} />}
                    onClick={() => setAction({ type: 'create', kind: 'dir', value: '' })}
                    disabled={!canWrite}
                  >
                    Folder
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw size={14} />}
                    onClick={() => selectedId && void runScan(selectedId)}
                    loading={scanning}
                    aria-label="Rescan project"
                  />
                </div>
              </div>

              {scanError ? (
                <Alert
                  tone="danger"
                  title="The project could not be scanned"
                  action={
                    <Button variant="default" size="sm" onClick={() => selectedId && void runScan(selectedId)}>
                      Retry
                    </Button>
                  }
                >
                  {scanError}
                </Alert>
              ) : null}

              {!canWrite ? (
                <Alert tone="info" title="Read-only mode">
                  Enable “Modify files” in Settings → Permissions to create, edit, or delete files.
                </Alert>
              ) : null}

              <div className="project-split">
                <Card className="file-browser">
                  <div className="file-browser-head">
                    <div className="file-browser-title">
                      <span>Explorer</span>
                      {scan ? <Badge tone="neutral">{scan.files + scan.directories}</Badge> : null}
                    </div>
                    <div className="file-search">
                      <Search size={12} />
                      <input
                        ref={searchRef}
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value)
                          if (!event.target.value.trim()) setHits(null)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void runSearch()
                        }}
                        placeholder="Find in files"
                        aria-label="Search inside project files"
                      />
                      {query ? (
                        <button
                          type="button"
                          aria-label="Clear search"
                          onClick={() => {
                            setQuery('')
                            setHits(null)
                          }}
                        >
                          <X size={11} />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {scanning ? (
                    <div className="tree-loading">
                      <Spinner size={16} />
                      Reading the workspace…
                    </div>
                  ) : hits !== null ? (
                    <div className="hit-list">
                      <div className="hit-list-head">
                        <span>
                          {searching ? 'Searching…' : `${plural(hits.length, 'match', 'matches')} for “${query}”`}
                        </span>
                        <button type="button" className="link-button" onClick={() => setHits(null)}>
                          Back to files
                        </button>
                      </div>
                      {hits.length ? (
                        hits.map((hit, index) => (
                          <button
                            key={`${hit.path}-${hit.line}-${index}`}
                            type="button"
                            className="hit-row"
                            onClick={() => void openFile(hit.path)}
                          >
                            <span className="hit-path">
                              {hit.path}
                              <span>:{hit.line}</span>
                            </span>
                            <span className="hit-preview">{hit.preview}</span>
                          </button>
                        ))
                      ) : (
                        <div className="hit-empty">No matches in readable project files.</div>
                      )}
                    </div>
                  ) : (
                    <div className="file-tree">
                      {scan?.tree.length ? (
                        scan.tree.map((node) => (
                          <FileTreeNode
                            key={node.path}
                            node={node}
                            depth={0}
                            selectedPath={selectedPath}
                            onSelect={(selected) => void openFile(selected.path)}
                          />
                        ))
                      ) : (
                        <div className="tree-loading">
                          {scan ? 'This folder is empty or unreadable.' : 'Select a project to begin.'}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="file-browser-foot">
                    <span>{scan ? plural(scan.files, 'file') : '—'}</span>
                    <span>{scan?.truncated ? 'Scan capped' : 'Read-only preview'}</span>
                  </div>
                </Card>

                <Card className="editor-pane">
                  {previewLoading ? (
                    <div className="editor-loading">
                      <Spinner size={18} />
                      Opening file…
                    </div>
                  ) : preview ? (
                    <>
                      <header className="editor-head">
                        <div className="editor-file">
                          <span className="editor-file-icon">
                            <Code2 size={14} />
                          </span>
                          <div>
                            <strong>{preview.name}</strong>
                            <small>
                              {languageLabel(preview.path)} · {formatBytes(preview.size)}
                            </small>
                          </div>
                        </div>
                        <div className="editor-actions">
                          {dirty && reviewDiff ? (
                            <span className="diff-stat">
                              <span className="is-add">+{reviewDiff.added}</span>
                              <span className="is-del">−{reviewDiff.removed}</span>
                            </span>
                          ) : null}
                          {dirty ? <Badge tone="warning">Unsaved</Badge> : null}
                          <IconButton label="Reveal in Explorer" size="sm" onClick={() => void revealSelected()}>
                            <FolderOpen size={13} />
                          </IconButton>
                          <IconButton
                            label="Rename file"
                            size="sm"
                            onClick={() =>
                              setAction({ type: 'rename', from: preview.path, value: preview.path })
                            }
                            disabled={!canWrite}
                          >
                            <Pencil size={13} />
                          </IconButton>
                          <IconButton
                            label="Move to Recycle Bin"
                            size="sm"
                            onClick={() => setAction({ type: 'delete-file', path: preview.path })}
                            disabled={!canWrite}
                          >
                            <Trash2 size={13} />
                          </IconButton>
                          <IconButton
                            label="Revert changes"
                            size="sm"
                            onClick={() => {
                              setDraft(preview.content)
                              setDirty(false)
                            }}
                            disabled={!dirty}
                          >
                            <Undo2 size={13} />
                          </IconButton>
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<FileDiff size={13} />}
                            onClick={() => setReviewOpen(true)}
                            loading={saving}
                            disabled={!dirty || !canWrite}
                          >
                            Review & save
                          </Button>
                        </div>
                      </header>
                      <div className="editor-path">
                        {preview.path.split('/').map((part, index, array) => (
                          <span key={`${part}-${index}`}>
                            {part}
                            {index < array.length - 1 ? <ChevronRight size={10} /> : null}
                          </span>
                        ))}
                      </div>
                      {preview.binary ? (
                        <div className="editor-binary">
                          <File size={26} />
                          <strong>Binary file</strong>
                          <p>IGRIS previews text only. Open this file in its native application.</p>
                          <Button variant="default" size="sm" onClick={() => void revealSelected()}>
                            Reveal in Explorer
                          </Button>
                        </div>
                      ) : (
                        <textarea
                          className="code-editor"
                          value={draft}
                          onChange={(event) => {
                            setDraft(event.target.value)
                            setDirty(event.target.value !== preview.content)
                          }}
                          onKeyDown={(event) => {
                            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                              event.preventDefault()
                              if (dirty && canWrite) setReviewOpen(true)
                            }
                          }}
                          spellCheck={false}
                          wrap="off"
                          aria-label={`Editing ${preview.name}`}
                        />
                      )}
                      <footer className="editor-foot">
                        <span>{preview.path}</span>
                        <span>
                          {draft.split('\n').length} lines · {preview.truncated ? 'preview truncated · ' : ''}
                          UTF-8
                        </span>
                      </footer>
                    </>
                  ) : (
                    <div className="editor-empty">
                      <EmptyState
                        icon={File}
                        title="Select a file"
                        description="Choose a file from the explorer to preview and edit it. Writes create a backup first."
                      />
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}
        </section>
      </div>

      <Modal
        open={reviewOpen}
        onClose={() => {
          if (!saving) setReviewOpen(false)
        }}
        title="Review file changes"
        subtitle={
          preview
            ? `${preview.path} · +${reviewDiff?.added ?? 0} / −${reviewDiff?.removed ?? 0} lines`
            : 'No file selected'
        }
        width={900}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={() => {
                if (!preview) return
                setDraft(preview.content)
                setDirty(false)
                setReviewOpen(false)
                log(`discard · ${preview.path}`, 'warning')
              }}
              disabled={saving}
            >
              Discard changes
            </Button>
            <Button
              variant="primary"
              icon={<FileDiff size={13} />}
              onClick={() => void saveFile()}
              loading={saving}
              disabled={!dirty || !canWrite}
            >
              Save changes
            </Button>
          </>
        }
      >
        {reviewDiff ? (
          reviewDiff.hunks.length ? (
            <div className="diff-view">
              {reviewDiff.truncated ? (
                <p className="diff-note">Large file: comparison capped at 1,600 lines.</p>
              ) : null}
              {reviewDiff.hunks.map((hunk, index) => (
                <div className="diff-hunk" key={`${hunk.oldStart}-${hunk.newStart}-${index}`}>
                  <div className="diff-hunk-head">
                    @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                  </div>
                  {hunk.lines.map((line, lineIndex) => (
                    <div
                      className={clsx('diff-row', `is-${line.kind}`)}
                      key={`${line.kind}-${lineIndex}-${line.oldLine ?? line.newLine ?? 0}`}
                    >
                      <span className="diff-line">{line.oldLine ?? ''}</span>
                      <span className="diff-line">{line.newLine ?? ''}</span>
                      <span className="diff-mark">
                        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                      </span>
                      <span className="diff-text">{line.text || ' '}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="diff-note">No textual additions or deletions were detected.</p>
          )
        ) : (
          <p className="diff-note">Edit the file to generate a reviewable diff.</p>
        )}
        <p className="settings-fineprint">
          Saving writes inside the approved root and creates a timestamped backup first when the
          backend supports it. Nothing is written until you confirm here.
        </p>
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setAction(null)}
        title={actionTitle}
        subtitle={
          action?.type === 'rename'
            ? 'Paths are relative to the approved project root.'
            : 'Use a path relative to the project root, for example src/components/Button.tsx.'
        }
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)} disabled={actionBusy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirmAction()}
              loading={actionBusy}
              disabled={!actionValue.trim()}
            >
              {actionLabel}
            </Button>
          </>
        }
      >
        <Input
          value={actionValue}
          onChange={(event) =>
            setAction((current) =>
              current && 'value' in current ? { ...current, value: event.target.value } : current
            )
          }
          placeholder={action?.type === 'create' && action.kind === 'dir' ? 'new-folder' : 'path/to/file.ts'}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void confirmAction()
          }}
          autoFocus
        />
      </Modal>

      <ConfirmDialog
        open={action?.type === 'delete-file'}
        title="Move this file to the Recycle Bin?"
        description={
          <>
            <strong>{action && 'path' in action ? action.path : ''}</strong> will be removed from
            the project. You can restore it from the Windows Recycle Bin.
          </>
        }
        confirmLabel="Move to Recycle Bin"
        busy={actionBusy}
        onCancel={() => setAction(null)}
        onConfirm={() => void confirmAction()}
      />

      <ConfirmDialog
        open={action?.type === 'remove-project'}
        title="Remove this project from IGRIS?"
        description={
          <>
            IGRIS will forget the approved folder <strong>{removingProject?.name ?? ''}</strong>.
            The files on disk are not deleted.
          </>
        }
        confirmLabel="Remove project"
        busy={actionBusy}
        onCancel={() => setAction(null)}
        onConfirm={() => void confirmAction()}
      />
    </div>
  )
}
