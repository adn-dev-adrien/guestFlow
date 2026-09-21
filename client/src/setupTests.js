// Test runner setup — auto-loaded by Vitest before each test file
// (specs/cra-to-vite-migration.md §3.2). Extends Vitest's `expect` with the
// `@testing-library/jest-dom` DOM matchers (`toBeInTheDocument`, `toBeDisabled`, …) —
// the same auto-load CRA's `react-scripts test` used to do under the hood.
import '@testing-library/jest-dom';

// jsdom 30.1 hands a focus event the Document as its `relatedTarget` when nothing was focused
// before; browsers hand `null`. MUI's FocusTrap keeps that value to give focus back on close and
// calls `.focus()` on it — which a Document does not have, so every dialog test crashed on unmount.
// Restore the browser behaviour rather than pinning jsdom.
const relatedTarget = Object.getOwnPropertyDescriptor(FocusEvent.prototype, 'relatedTarget');
Object.defineProperty(FocusEvent.prototype, 'relatedTarget', {
  ...relatedTarget,
  get() {
    const target = relatedTarget.get.call(this);
    return target instanceof Document ? null : target;
  },
});
