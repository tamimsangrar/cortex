'use client';

/**
 * Safe wrapper around window.cortex IPC calls.
 * Returns null when running outside Electron (e.g., Next.js dev server in browser).
 */
export function ipc() {
  if (typeof window !== 'undefined' && window.cortex) {
    return window.cortex;
  }
  return null;
}
