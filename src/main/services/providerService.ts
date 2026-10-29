import { randomUUID } from 'node:crypto'
import type {
  ModelListResult,
  ProviderDto,
  ProviderDraft,
  ProviderInput,
  ProviderKind,
  ProviderTestResult
} from '@shared/types'
import { PROVIDER_CATALOG, PROVIDER_ORDER } from '@shared/defaults'
import type { ProviderRepository, ProviderRow } from '../storage/repositories'
import type { CredentialStore } from '../security/credentials'
import { AppError, normalizeError } from '../security/errors'
import type { Logger } from './logger'
import { validateBaseUrl, normalizeBaseUrl } from '../ai/http'
import { OpenAiAdapter } from '../ai/providers/openai'
import { AnthropicAdapter } from '../ai/providers/anthropic'
import { GeminiAdapter } from '../ai/providers/gemini'
import type { ProviderAdapter, ProviderRuntimeConfig } from '../ai/types'

export interface ResolvedProvider {
  provider: ProviderRow
  dto: ProviderDto
  model: string
  apiKey: string | null
  runtime: ProviderRuntimeConfig
  adapter: ProviderAdapter
}

export class ProviderService {
  constructor(
    private readonly repo: ProviderRepository,
    private readonly credentials: CredentialStore,
    private readonly logger: Logger
  ) {}

  private adapter(kind: ProviderKind): ProviderAdapter {
    switch (kind) {
      case 'openai':
        return new OpenAiAdapter(false)
      case 'anthropic':
        return new AnthropicAdapter()
      case 'gemini':
        return new GeminiAdapter()
      case 'openai-compatible':
        return new OpenAiAdapter(true)
      default:
        throw new AppError('VALIDATION', 'Unsupported provider type.')
    }
  }

  private toDto(provider: ProviderRow): ProviderDto {
    return {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      hasKey: Boolean(provider.apiKeyEnc?.byteLength),
      keyHint: provider.keyHint,
      isDefault: provider.isDefault,
      supportsTools: provider.supportsTools,
      lastTest: provider.lastTest,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    }
  }

  list(): ProviderDto[] {
    return this.repo.list().map((provider) => this.toDto(provider))
  }

  defaultProvider(): ProviderDto | null {
    const provider = this.repo.getDefault()
    return provider ? this.toDto(provider) : null
  }

  private normalizeKind(value: string): ProviderKind {
    if (!PROVIDER_ORDER.includes(value as ProviderKind)) {
      throw new AppError('VALIDATION', 'Unknown provider type.')
    }
    return value as ProviderKind
  }

  private normalizedBaseUrl(kind: ProviderKind, input: string | undefined): string {
    const catalog = PROVIDER_CATALOG[kind]
    const raw = catalog.allowsCustomBaseUrl
      ? (input ?? '').trim() || catalog.defaultBaseUrl
      : catalog.defaultBaseUrl
    if (!raw) {
      throw new AppError('VALIDATION', 'A base URL is required for this provider type.')
    }
    return validateBaseUrl(raw)
  }

  save(input: ProviderInput, logger: Logger = this.logger): ProviderDto {
    try {
      const kind = this.normalizeKind(input.kind)
      const name = (input.name ?? '').trim()
      if (!name) throw new AppError('VALIDATION', 'Give this provider a name.')
      if (name.length > 80) throw new AppError('VALIDATION', 'Provider names are limited to 80 characters.')
      const existing = input.id ? this.repo.get(input.id) : null
      if (input.id && !existing) throw new AppError('NOT_FOUND', 'That provider no longer exists.')
      if (existing && existing.kind !== kind) {
        throw new AppError(
          'VALIDATION',
          'Create a new provider to change its API type. Existing credentials are tied to a provider type.'
        )
      }

      const baseUrl = this.normalizedBaseUrl(kind, input.baseUrl ?? existing?.baseUrl)
      const catalog = PROVIDER_CATALOG[kind]
      const model = (input.defaultModel ?? existing?.defaultModel ?? '').trim().slice(0, 200)
      const now = new Date().toISOString()

      let keyEnc = existing?.apiKeyEnc ?? null
      let keyHint = existing?.keyHint ?? null
      let clearKey = false
      let keyChanged = false

      if (input.apiKey !== undefined) {
        const trimmed = input.apiKey.trim()
        if (!trimmed) {
          keyEnc = null
          keyHint = null
          clearKey = true
          keyChanged = Boolean(existing?.apiKeyEnc)
        } else {
          if (trimmed.length > 2000) throw new AppError('VALIDATION', 'That API key is too long.')
          keyEnc = this.credentials.encrypt(trimmed)
          keyHint = (() => {
            const hint = trimmed.slice(-4)
            return hint ? `••••${hint}` : null
          })()
          keyChanged = true
        }
      }

      if (!existing && catalog.requiresKey && !keyEnc) {
        throw new AppError('VALIDATION', `${catalog.label} requires an API key.`)
      }

      const configChanged =
        !existing ||
        existing.baseUrl !== baseUrl ||
        existing.defaultModel !== model ||
        existing.supportsTools !== (input.supportsTools ?? existing.supportsTools) ||
        keyChanged

      const provider: ProviderRow = {
        id: existing?.id ?? randomUUID(),
        name,
        kind,
        baseUrl,
        apiKeyEnc: keyEnc,
        keyHint,
        defaultModel: model,
        supportsTools: input.supportsTools ?? existing?.supportsTools ?? true,
        isDefault: existing?.isDefault ?? this.repo.count() === 0,
        lastTest: configChanged ? null : (existing?.lastTest ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      this.repo.save(provider)
      logger.info('providers', `${existing ? 'Updated' : 'Added'} provider ${name} (${kind}).`)
      if (clearKey) logger.info('providers', `Cleared stored key for provider ${name}.`)
      return this.toDto(this.repo.get(provider.id) ?? provider)
    } catch (error) {
      const normalized = normalizeError(error, 'The provider could not be saved.')
      throw normalized
    }
  }

  remove(id: string): void {
    const provider = this.repo.get(id)
    if (!provider) throw new AppError('NOT_FOUND', 'Provider not found.')
    this.repo.remove(id)
    const remaining = this.repo.list()
    if (provider.isDefault && remaining.length > 0 && remaining[0]) {
      this.repo.setDefault(remaining[0].id)
    }
    this.logger.info('providers', `Removed provider ${provider.name}.`)
  }

  setDefault(id: string): ProviderDto[] {
    if (!this.repo.get(id)) throw new AppError('NOT_FOUND', 'Provider not found.')
    this.repo.setDefault(id)
    return this.list()
  }

  setModel(id: string, model: string): ProviderDto {
    const clean = model.trim()
    if (!clean) throw new AppError('VALIDATION', 'Choose a model first.')
    const provider = this.repo.get(id)
    if (!provider) throw new AppError('NOT_FOUND', 'Provider not found.')
    this.repo.patch(id, { defaultModel: clean.slice(0, 200), lastTest: null })
    return this.toDto(this.repo.get(id) as ProviderRow)
  }

  private resolveDraft(draft: ProviderDraft): {
    provider: ProviderRow
    apiKey: string | null
    model: string | undefined
  } {
    const saved = draft.providerId ? this.repo.get(draft.providerId) : null
    const kind = this.normalizeKind(draft.kind ?? saved?.kind ?? '')
    const baseUrl = this.normalizedBaseUrl(kind, draft.baseUrl ?? saved?.baseUrl)
    const apiKey =
      draft.apiKey !== undefined
        ? draft.apiKey.trim() || null
        : this.credentials.decrypt(saved?.apiKeyEnc ?? null)
    const model = (draft.model ?? saved?.defaultModel ?? '').trim() || undefined
    if (PROVIDER_CATALOG[kind].requiresKey && !apiKey) {
      throw new AppError(
        'AUTH',
        `Enter a ${PROVIDER_CATALOG[kind].label} API key before testing this connection.`
      )
    }
    const provider: ProviderRow = {
      id: saved?.id ?? 'draft',
      name: saved?.name ?? 'Draft provider',
      kind,
      baseUrl,
      apiKeyEnc: null,
      keyHint: null,
      defaultModel: model ?? '',
      supportsTools: saved?.supportsTools ?? true,
      isDefault: saved?.isDefault ?? false,
      lastTest: null,
      createdAt: saved?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    return { provider, apiKey, model }
  }

  async listModels(draft: ProviderDraft): Promise<ModelListResult> {
    try {
      const { provider, apiKey } = this.resolveDraft(draft)
      const adapter = this.adapter(provider.kind)
      if (!adapter.supportsModelList) {
        return {
          supported: false,
          models: [],
          message: 'This provider does not expose a model list. Enter a model ID manually.'
        }
      }
      const models = await adapter.listModels({
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        apiKey,
        supportsTools: provider.supportsTools
      })
      return {
        supported: true,
        models,
        message: models.length
          ? `${models.length} models reported by the provider.`
          : 'The provider returned an empty model list. You can enter a model ID manually.'
      }
    } catch (error) {
      const normalized = normalizeError(error, 'The model list could not be fetched.')
      this.logger.warn('providers', `Model list failed: ${normalized.code} ${normalized.userMessage}`)
      return {
        supported: false,
        models: [],
        message: `${normalized.userMessage} You can still enter a model ID manually.`
      }
    }
  }

  async test(draft: ProviderDraft): Promise<ProviderTestResult> {
    const at = new Date().toISOString()
    try {
      const { provider, apiKey, model } = this.resolveDraft(draft)
      const adapter = this.adapter(provider.kind)
      const outcome = await adapter.test(
        {
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          apiKey,
          supportsTools: provider.supportsTools
        },
        model
      )
      const result: ProviderTestResult = {
        ok: outcome.ok,
        message: outcome.message,
        at,
        latencyMs: outcome.latencyMs,
        models: outcome.models?.slice(0, 500)
      }
      if (draft.providerId) {
        const saved = this.repo.get(draft.providerId)
        if (saved) this.repo.patch(saved.id, { lastTest: result })
      }
      this.logger.info(
        'providers',
        `Connection test ${outcome.ok ? 'succeeded' : 'failed'} for ${provider.name}${model ? ` / ${model}` : ''}.`
      )
      return result
    } catch (error) {
      const normalized = normalizeError(error, 'The connection test failed.')
      const result: ProviderTestResult = {
        ok: false,
        message: normalized.userMessage,
        at
      }
      if (draft.providerId) {
        const saved = this.repo.get(draft.providerId)
        if (saved) this.repo.patch(saved.id, { lastTest: result })
      }
      this.logger.warn(
        'providers',
        `Connection test failed: ${normalized.code} ${normalized.userMessage}`
      )
      return result
    }
  }

  resolve(providerId?: string, modelOverride?: string): ResolvedProvider {
    const provider = providerId ? this.repo.get(providerId) : this.repo.getDefault()
    if (!provider) {
      throw new AppError(
        'CONFIG',
        providerId
          ? 'That AI provider no longer exists.'
          : 'No AI provider is configured. Add one in AI Models.'
      )
    }
    const model = (modelOverride ?? provider.defaultModel).trim()
    if (!model) {
      throw new AppError('CONFIG', 'Select a model for this provider in AI Models.')
    }
    const catalog = PROVIDER_CATALOG[provider.kind]
    const apiKey = this.credentials.decrypt(provider.apiKeyEnc)
    if (catalog.requiresKey && !apiKey) {
      throw new AppError(
        'AUTH',
        `No API key is stored for ${provider.name}. Re-enter the key in AI Models.`
      )
    }
    const runtime: ProviderRuntimeConfig = {
      kind: provider.kind,
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      apiKey,
      supportsTools: provider.supportsTools
    }
    return {
      provider,
      dto: this.toDto(provider),
      model,
      apiKey,
      runtime,
      adapter: this.adapter(provider.kind)
    }
  }
}
