import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { pushSupported, registerServiceWorker, enablePush, appServerKeyMatches } from '../registerPush';

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

describe('appServerKeyMatches — detects a stale VAPID key on a subscription', () => {
  const current = new Uint8Array([1, 2, 3, 4]);

  test('same bytes (ArrayBuffer) → match', () => {
    expect(appServerKeyMatches(new Uint8Array([1, 2, 3, 4]).buffer, current)).toBe(true);
  });

  test('different bytes → mismatch (the device must re-subscribe)', () => {
    expect(appServerKeyMatches(new Uint8Array([9, 9, 9, 9]).buffer, current)).toBe(false);
  });

  test('different length → mismatch', () => {
    expect(appServerKeyMatches(new Uint8Array([1, 2, 3]).buffer, current)).toBe(false);
  });

  test('null/absent existing key → mismatch (force a clean re-subscribe)', () => {
    expect(appServerKeyMatches(null, current)).toBe(false);
    expect(appServerKeyMatches(undefined, current)).toBe(false);
  });
});
