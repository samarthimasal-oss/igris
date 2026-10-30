import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  History,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { useAppStore } from '../lib/store'
import { plainPreview } from '../components/Markdown'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageHeader
} from '../components/ui'
import { plural, relativeTime, truncate } from '../lib/format'

export function HistoryPage() {
  const navigate = useNavigate()
  const conversations = useAppStore((state) => state.conversations)
  const refreshConversations = useAppStore((state) => state.refreshConversations)
  const deleteConversation = useAppStore((state) => state.deleteConversation)
  const renameConversation = useAppStore((state) => state.renameConversation)
  const newConversation = useAppStore((state) => state.newConversation)

  const [query, setQuery] = useState('')
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [busyDialog, setBusyDialog] = useState(false)

  useEffect(() => {
    void refreshConversations()
  }, [refreshConversations])

  const filteredConversations = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return conversations
    return conversations.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(needle) ||
        (conversation.lastMessage ?? '').toLowerCase().includes(needle)
    )
  }, [conversations, query])

  const startNew = (): void => {
    newConversation()
    navigate('/chat')
  }

  const openRename = (id: string, title: string): void => {
    setRenameTarget({ id, title })
    setRenameValue(title)
  }

  const confirmRename = async (): Promise<void> => {
    if (!renameTarget || !renameValue.trim()) return
    setBusyDialog(true)
    await renameConversation(renameTarget.id, renameValue.trim())
    setBusyDialog(false)
    setRenameTarget(null)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    setBusyDialog(true)
    await deleteConversation(deleteTarget.id)
    setBusyDialog(false)
    setDeleteTarget(null)
  }

  return (
    <div className="page history-page">
      <PageHeader
        eyebrow="Archive"
        title="History"
        description="Every conversation stays on this PC. Search it, resume a thread, or clear what you no longer need."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={startNew}>
            New conversation
          </Button>
        }
      />

      <div className="history-toolbar">
        <div className="history-search">
          <Search size={14} />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          ) : null}
        </div>
        <div className="history-summary">
          <Badge tone="neutral">
            {filteredConversations.length} of {conversations.length}
          </Badge>
          <span>Stored locally</span>
        </div>
      </div>

      <Card className="history-card">
        {filteredConversations.length ? (
          <div className="history-list">
            {filteredConversations.map((conversation) => (
              <div key={conversation.id} className="history-row">
                <button
                  type="button"
                  className="history-main"
                  onClick={() => navigate(`/chat/${conversation.id}`)}
                >
                  <span className="history-icon">
                    <MessageSquare size={15} />
                  </span>
                  <span className="history-copy">
                    <strong>{conversation.title}</strong>
                    <small>
                      {conversation.lastMessage
                        ? truncate(plainPreview(conversation.lastMessage, 160), 160)
                        : 'No messages yet'}
                    </small>
                  </span>
                  <span className="history-meta">
                    <span>{relativeTime(conversation.updatedAt)}</span>
                    <small>{plural(conversation.messageCount, 'message')}</small>
                  </span>
                </button>
                <div className="history-actions">
                  <IconButton
                    label={`Rename ${conversation.title}`}
                    size="sm"
                    onClick={() => openRename(conversation.id, conversation.title)}
                  >
                    <Pencil size={12} />
                  </IconButton>
                  <IconButton
                    label={`Delete ${conversation.title}`}
                    size="sm"
                    onClick={() => setDeleteTarget(conversation)}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={History}
            title={query ? 'No threads match that search' : 'No conversation history yet'}
            description={
              query
                ? 'Try a different word, or clear the search to see every thread.'
                : 'Start a conversation and it will appear here, stored only on this PC.'
            }
            action={
              query ? (
                <Button variant="default" size="sm" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              ) : (
                <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={startNew}>
                  New conversation
                </Button>
              )
            }
          />
        )}
      </Card>

      <p className="history-note">
        Retention and clearing live in <strong>Settings</strong> under <strong>Privacy &amp; data</strong>.
        Nothing here is uploaded.
      </p>

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename conversation"
        width={460}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirmRename()}
              loading={busyDialog}
              disabled={!renameValue.trim()}
            >
              Save title
            </Button>
          </>
        }
      >
        <Input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          maxLength={120}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') void confirmRename()
          }}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this conversation?"
        description={
          <>
            <strong>{deleteTarget?.title}</strong> and its messages will be removed from the local
            database. This cannot be undone.
          </>
        }
        confirmLabel="Delete conversation"
        busy={busyDialog}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  )
}
