import { AppError, normalizeError } from '../security/errors'
import { assertOk, httpRequest, normalizeBaseUrl } from '../ai/http'
import type { ProviderService, ResolvedProvider } from './providerService'
import type { Logger } from './logger'

const TRANSCRIBE_PROMPT =
  'Transcribe this voice recording. Return only the exact words spoken, with no commentary, quotes, or extra formatting.'

/**
 * Transcribes microphone audio with the user's default cloud provider.
 * Implemented for Gemini (inline audio in generateContent); other provider
 * kinds surface a clear, actionable error instead of silently failing.
 */
export class VoiceService {
  constructor(
    private readonly providers: ProviderService,
    private readonly logger: Logger
  ) {}

  async transcribe(audioBase64: string, mimeType: string): Promise<string> {
    const resolved = this.providers.resolve()
    if (resolved.provider.kind !== 'gemini') {
      throw new AppError(
        'UNSUPPORTED',
        'Voice transcription currently runs on Gemini. Set your Gemini provider as the default in AI Models to use the microphone.'
      )
    }
    return this.transcribeWithGemini(resolved, audioBase64, mimeType)
  }

  private async transcribeWithGemini(
    resolved: ResolvedProvider,
    audioBase64: string,
    mimeType: string
  ): Promise<string> {
    const model = encodeURIComponent(resolved.model.replace(/^models\//, ''))
    const url = `${normalizeBaseUrl(resolved.provider.baseUrl)}/models/${model}:generateContent?key=${encodeURIComponent(resolved.apiKey ?? '')}`
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: TRANSCRIBE_PROMPT },
            { inlineData: { mimeType, data: audioBase64 } }
          ]
        }
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 2048 }
    }

    let response: Response
    try {
      response = await httpRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000)
      })
    } catch (error) {
      throw normalizeError(error)
    }

    try {
      await assertOk(response)
    } catch (error) {
      this.logger.warn('voice', `Transcription request failed (HTTP ${response.status})`)
      throw error
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim()
    if (!text) {
      throw new AppError('PROVIDER', 'I could not hear anything to transcribe. Try again a bit louder.')
    }
    return text
  }
}
