import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// A loaded runner answers findBy* in more than the default second (audit R36-S3): as the studio's suite does.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => { cleanup(); window.localStorage.clear(); });

if (!window.matchMedia) {
  window.matchMedia = vi.fn((query) => ({
    matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
}
if (!window.CSS) window.CSS = {};
if (!window.CSS.escape) window.CSS.escape = (s) => String(s).replace(/"/g, '\\"');
