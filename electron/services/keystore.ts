/**
 * Secure API key storage using Electron's safeStorage (OS keychain).
 * Keys are encrypted at rest and stored in the app's userData directory.
 */
import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

const KEYS_DIR_NAME = 'cortex-keys';

function getKeysDir(): string {
  return path.join(app.getPath('userData'), KEYS_DIR_NAME);
}

function ensureKeysDir(): void {
  const dir = getKeysDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getKeyPath(provider: string): string {
  return path.join(getKeysDir(), `${provider}.enc`);
}

/** Encrypts and saves an API key for the given provider. */
export function saveApiKey(provider: string, key: string): void {
  ensureKeysDir();
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system');
  }
  const encrypted = safeStorage.encryptString(key);
  fs.writeFileSync(getKeyPath(provider), encrypted);
}

/** Loads and decrypts an API key for the given provider, or null if not stored. */
export function loadApiKey(provider: string): string | null {
  const keyPath = getKeyPath(provider);
  if (!fs.existsSync(keyPath)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system');
  }
  const encrypted = fs.readFileSync(keyPath);
  return safeStorage.decryptString(encrypted);
}

export function deleteApiKey(provider: string): void {
  const keyPath = getKeyPath(provider);
  if (fs.existsSync(keyPath)) {
    fs.unlinkSync(keyPath);
  }
}

export function hasApiKey(provider: string): boolean {
  return fs.existsSync(getKeyPath(provider));
}
