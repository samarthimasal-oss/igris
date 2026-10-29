import { safeStorage } from 'electron'
import { AppError } from './errors'
import { redactSecrets } from './redaction'

export class CredentialStore {
  available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  encrypt(secret: string): Uint8Array {
    if (!secret) throw new AppError('VALIDATION', 'An API key is required.')
    if (!this.available()) {
      throw new AppError(
        'CONFIG',
        'Windows credential encryption is unavailable, so IGRIS will not store this key. Restart the app and try again.'
      )
    }
    try {
      return safeStorage.encryptString(secret)
    } catch (error) {
      throw new AppError('CONFIG', 'IGRIS could not encrypt the credential with Windows DPAPI.', {
        cause: error
      })
    }
  }

  decrypt(encrypted: Uint8Array | null): string | null {
    if (!encrypted || encrypted.byteLength === 0) return null
    try {
      return safeStorage.decryptString(Buffer.from(encrypted))
    } catch (error) {
      throw new AppError(
        'AUTH',
        'The stored credential could not be decrypted. Re-enter the API key for this provider.',
        { cause: error }
      )
    }
  }

  static hint(secret: string): string {
    const trimmed = secret.trim()
    if (trimmed.length <= 4) return '••••'
    return `••••${trimmed.slice(-4)}`
  }

  static assertNotLogged(value: string): void {
    // Defensive helper used by tests: secrets should never survive redaction.
    if (redactSecrets(value) !== value) {
      throw new AppError('INTERNAL', 'A secret reached a loggable value.')
    }
  }
}
