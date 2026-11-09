import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Lazy screens and key-by-key typing: give `findBy` / `waitFor` more than the default second under load.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => { cleanup(); });

if (!window.matchMedia) {
  window.matchMedia = vi.fn((query) => ({
    matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

// jsdom hands a focus event the Document as its `relatedTarget` when nothing was focused before; browsers hand
// `null`, and MUI's FocusTrap calls `.focus()` on it (same fix as client/src/setupTests.js).
const relatedTarget = Object.getOwnPropertyDescriptor(FocusEvent.prototype, 'relatedTarget');
Object.defineProperty(FocusEvent.prototype, 'relatedTarget', {
  ...relatedTarget,
  get() {
    const target = relatedTarget.get.call(this);
    return target instanceof Document ? null : target;
  },
});
