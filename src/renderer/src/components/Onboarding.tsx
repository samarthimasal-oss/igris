import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Cpu,
  Lock,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import { PERMISSION_META } from '@shared/defaults'
import type { PermissionKey } from '@shared/types'
import { useAppStore } from '../lib/store'
import { Button, Toggle } from './ui'
import clsx from 'clsx'

const STEPS = [
  { label: 'Welcome', icon: Sparkles },
  { label: 'Intelligence', icon: Cpu },
  { label: 'Capabilities', icon: ShieldCheck },
  { label: 'Ready', icon: CheckCircle2 }
]

const ONBOARDING_PERMISSIONS: PermissionKey[] = [
  'filesystem',
  'fileWrite',
  'terminal',
  'browser',
  'screen',
  'appLaunch'
]

export function Onboarding() {
  const open = useAppStore((state) => state.onboardingOpen)
  const settings = useAppStore((state) => state.settings)
  const providers = useAppStore((state) => state.providers)
  const completeOnboarding = useAppStore((state) => state.completeOnboarding)
  const closeOnboarding = useAppStore((state) => state.closeOnboarding)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const notify = useAppStore((state) => state.notify)
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  if (!open || !settings) return null

  const enabledPermissions = ONBOARDING_PERMISSIONS.filter(
    (key) => settings.permissions[key]
  ).length
  const provider = providers.find((item) => item.isDefault) ?? providers[0] ?? null

  const setPermission = async (key: PermissionKey, value: boolean): Promise<void> => {
    try {
      await updateSettings({ permissions: { [key]: value } })
    } catch (error) {
      notify('error', 'Could not save permission', error instanceof Error ? error.message : undefined)
    }
  }

  const finish = async (): Promise<void> => {
    setBusy(true)
    await completeOnboarding()
    setBusy(false)
  }

  const configureModels = async (): Promise<void> => {
    setBusy(true)
    await completeOnboarding()
    setBusy(false)
    navigate('/models')
  }

  return (
    <div className="onboarding">
      <div className="onboarding-shell">
        <aside className="onboarding-aside">
          <div className="onboarding-brand">
            <span className="brand-mark brand-mark-large" aria-hidden>
              <span className="brand-ring" />
              <span className="brand-core" />
            </span>
            <span className="brand-name">IGRIS</span>
          </div>
          <div className="onboarding-orb" aria-hidden>
            <span className="onboarding-orb-ring" />
            <span className="onboarding-orb-core" />
          </div>
          <p className="onboarding-quote">
            “A calm surface for an entire machine. Ask, direct, verify.”
          </p>
          <div className="onboarding-steps">
            {STEPS.map((item, index) => {
              const Icon = item.icon
              return (
                <div
                  key={item.label}
                  className={clsx(
                    'onboarding-step',
                    index === step && 'is-current',
                    index < step && 'is-complete'
                  )}
                >
                  <span className="onboarding-step-icon">
                    {index < step ? <Check size={13} /> : <Icon size={13} />}
                  </span>
                  <span>{item.label}</span>
                </div>
              )
            })}
          </div>
          <div className="onboarding-aside-foot">
            <Lock size={13} />
            Data stays on this PC. Keys use Windows DPAPI.
          </div>
        </aside>

        <section className="onboarding-main">
          <button type="button" className="onboarding-skip" onClick={closeOnboarding}>
            Finish later
          </button>

          {step === 0 ? (
            <div className="onboarding-content">
              <span className="eyebrow">First contact</span>
              <h1>
                Good evening.
                <br />
                <span className="text-accent">IGRIS is listening.</span>
              </h1>
              <p className="onboarding-lead">
                A native Windows intelligence for thinking, building, and controlling your
                computer — with every consequential action kept behind your approval.
              </p>
              <div className="onboarding-points">
                <div>
                  <span>01</span>
                  <strong>Cloud intelligence</strong>
                  <p>Connect OpenAI, Anthropic, Gemini, OpenRouter, OpenCode, or a compatible endpoint. No local models.</p>
                </div>
                <div>
                  <span>02</span>
                  <strong>Real capability</strong>
                  <p>Files, projects, terminal, browser, and desktop tools — permissioned and audited.</p>
                </div>
                <div>
                  <span>03</span>
                  <strong>Real sight and voice</strong>
                  <p>Ask IGRIS to see your screen or speak to it — every capability stays permissioned and audited.</p>
                </div>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="onboarding-content">
              <span className="eyebrow">Intelligence layer</span>
              <h1>Connect your mind.</h1>
              <p className="onboarding-lead">
                IGRIS never simulates a model. Add a cloud provider and choose a model; the
                connection is tested live before it is used.
              </p>
              {provider ? (
                <div className="onboarding-provider is-connected">
                  <span className="provider-monogram">{provider.name.slice(0, 1)}</span>
                  <div>
                    <strong>{provider.name}</strong>
                    <p>
                      {provider.defaultModel || 'No model selected'} · key{' '}
                      {provider.hasKey ? provider.keyHint ?? 'stored' : 'not stored'}
                    </p>
                  </div>
                  <span className="badge badge-success">
                    <Check size={11} /> Connected
                  </span>
                </div>
              ) : (
                <div className="onboarding-provider">
                  <span className="provider-monogram">?</span>
                  <div>
                    <strong>No provider configured</strong>
                    <p>You can connect one now, or explore IGRIS first.</p>
                  </div>
                </div>
              )}
              <div className="onboarding-actions">
                <Button variant="primary" onClick={() => void configureModels()} loading={busy}>
                  Open AI models
                  <ArrowRight size={14} />
                </Button>
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Continue without AI
                </Button>
              </div>
              <div className="onboarding-note">
                <Lock size={14} />
                Keys are encrypted with Windows DPAPI and never reach the interface after saving.
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onboarding-content">
              <span className="eyebrow">Capabilities</span>
              <h1>Grant only what you need.</h1>
              <p className="onboarding-lead">
                Tools fail closed. Sensitive actions still ask for confirmation each time, and
                you can revoke access instantly.
              </p>
              <div className="onboarding-permissions">
                {ONBOARDING_PERMISSIONS.map((key) => {
                  const meta = PERMISSION_META[key]
                  return (
                    <Toggle
                      key={key}
                      checked={settings.permissions[key]}
                      onChange={(value) => void setPermission(key, value)}
                      label={meta.label}
                      description={meta.description}
                    />
                  )
                })}
              </div>
              <p className="onboarding-hint">
                Recommended for a first session: read projects and web browsing. You can enable
                the rest later in Settings.
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="onboarding-content">
              <span className="eyebrow">Systems nominal</span>
              <h1>Your assistant is ready.</h1>
              <p className="onboarding-lead">
                IGRIS is assembled and every subsystem is local. Start with a question, a
                project, or a task.
              </p>
              <div className="onboarding-summary">
                <div>
                  <span>Provider</span>
                  <strong>{provider ? provider.name : 'Not configured'}</strong>
                  <small>{provider?.defaultModel || 'Add one in AI models'}</small>
                </div>
                <div>
                  <span>Capabilities</span>
                  <strong>
                    {enabledPermissions} of {ONBOARDING_PERMISSIONS.length} enabled
                  </strong>
                  <small>Revocable at any time</small>
                </div>
                <div>
                  <span>Voice</span>
                  <strong>Microphone ready</strong>
                  <small>Hold the mic button in Conversation</small>
                </div>
              </div>
              <div className="onboarding-finish">
                <Button variant="primary" size="lg" onClick={() => void finish()} loading={busy}>
                  Enter IGRIS
                  <ArrowRight size={16} />
                </Button>
              </div>
            </div>
          ) : null}

          <footer className="onboarding-footer">
            <Button
              variant="ghost"
              icon={<ArrowLeft size={14} />}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
            >
              Back
            </Button>
            <span className="onboarding-progress">
              {String(step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
            </span>
            {step < STEPS.length - 1 ? (
              <Button
                variant="default"
                trailingIcon={<ArrowRight size={14} />}
                onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
              >
                Continue
              </Button>
            ) : (
              <span className="onboarding-footer-spacer" />
            )}
          </footer>
        </section>
      </div>
    </div>
  )
}
