import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { pushSupported, registerServiceWorker, enablePush } from '../registerPush';

// specs/pwa-push-notifications.md §4.2 — graceful degradation when push isn't supported.

describe('registerPush graceful degradation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('pushSupported() is false in a plain jsdom env (no serviceWorker/PushManager)', () => {
    // jsdom has navigator but no serviceWorker / PushManager by default.
    expect(pushSupported()).toBe(false);
  });

  test('registerServiceWorker() resolves to null (never throws) when unsupported', async () => {
    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  test('enablePush() rejects with a French message when unsupported', async () => {
    await expect(enablePush()).rejects.toThrow(/ne supporte pas/i);
  });
});
